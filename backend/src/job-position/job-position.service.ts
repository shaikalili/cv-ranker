import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common'
import { CV } from '@prisma/client'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'
import type { Logger as PinoBaseLogger } from 'pino'
import pLimit from 'p-limit'
import {
  Observable,
  ReplaySubject,
  concat,
  defer,
  from,
  interval,
  map,
  merge,
} from 'rxjs'

import { ParserService } from '../parser/parser.service'
import { AnonymizationService } from '../anonymization/anonymization.service'
import { FilterService } from '../filter/filter.service'
import { AiService, ScoreBatchItem } from '../ai/ai.service'
import { ScoringService } from '../scoring/scoring.service'
import { RankingService, RankedResults } from '../scoring/ranking.service'
import { JobDescriptionService } from '../job-description/job-description.service'
import { CvGeneratorService } from '../cv-generator/cv-generator.service'
import { GenerateCVsDto } from '../cv-generator/dto/generate-cvs.dto'
import { ResumeService } from '../resume/resume.service'
import {
  CVTier,
  ParsedCV,
  Requirement,
  KeywordScores,
} from '../common/types'
import { jobLogger, startOp } from '../common/logging'

export interface UploadedFile {
  originalname: string
  mimetype: string
  buffer: Buffer
}

export type ProgressStage =
  | 'generating'
  | 'parsing'
  | 'filtering'
  | 'scoring'
  | 'completed'
  | 'failed'
  | 'heartbeat'

interface CvRecord {
  id: string
  parsed: ParsedCV
  anonymizedText: string
  keywordScores: KeywordScores
  tier: CVTier
}

export interface ProgressEvent {
  stage: ProgressStage
  processed: number
  total: number
}

// Below typical proxy idle timeout (30–60s).
const HEARTBEAT_MS = 15_000

@Injectable()
export class JobPositionService {
  // ReplaySubject(1) so late/reconnecting SSE clients still receive the most recent event.
  private readonly progressStreams = new Map<
    string,
    ReplaySubject<ProgressEvent>
  >()

  constructor(
    private readonly parserService: ParserService,
    private readonly anonymizationService: AnonymizationService,
    private readonly filterService: FilterService,
    private readonly aiService: AiService,
    private readonly scoringService: ScoringService,
    private readonly rankingService: RankingService,
    private readonly jobDescriptionService: JobDescriptionService,
    private readonly cvGeneratorService: CvGeneratorService,
    private readonly resumeService: ResumeService,
    @InjectPinoLogger(JobPositionService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Validate the JSON column at the pipeline boundary — better than a cryptic throw deep inside FilterService.
  private ensureRequirements(
    jobPositionId: string,
    raw: unknown,
    action: 'upload' | 'generate' | 'rescore',
  ): Requirement[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException(
        'Job position has no requirements — extract them first',
      )
    }
    const bad = (raw as unknown[]).findIndex(
      (r) =>
        !r ||
        typeof r !== 'object' ||
        typeof (r as Requirement).id !== 'string' ||
        !Array.isArray((r as Requirement).keywords) ||
        !Array.isArray((r as Requirement).synonyms),
    )
    if (bad !== -1) {
      this.logger.error(
        {
          event: 'pipeline.requirements.invalid',
          jobPositionId,
          action,
          index: bad,
        },
        'requirements column has an invalid entry',
      )
      throw new UnprocessableEntityException(
        'Stored requirements are malformed — please re-extract them.',
      )
    }
    return raw as Requirement[]
  }

  // Central failure path for every background pipeline run: log, mark FAILED, emit failed SSE, tear down stream.
  private runWithPipelineGuard(
    log: PinoBaseLogger,
    jobPositionId: string,
    failedEvent: string,
    task: () => Promise<void>,
  ): void {
    void task().catch(async (err: unknown) => {
      log.error(
        { event: failedEvent, err },
        'pipeline failed',
      )
      const stream = this.progressStreams.get(jobPositionId)
      if (stream) {
        try {
          stream.next({ stage: 'failed', processed: 0, total: 0 })
          stream.complete()
        } catch (emitErr) {
          log.warn(
            { event: 'pipeline.progress.emit_failed', err: emitErr },
            'failed to emit failed-stage progress event',
          )
        }
        this.progressStreams.delete(jobPositionId)
      }
      try {
        await this.jobDescriptionService.markFailed(jobPositionId)
      } catch (markErr) {
        log.error(
          { event: 'pipeline.mark_failed.failed', err: markErr },
          'failed to mark job position as FAILED',
        )
      }
    })
  }

  async generateAndIngest(
    userId: string,
    jobPositionId: string,
    dto: GenerateCVsDto,
  ): Promise<{ queued: number }> {
    const jobPosition = await this.jobDescriptionService.findById(
      userId,
      jobPositionId,
    )
    const requirements = this.ensureRequirements(
      jobPositionId,
      jobPosition.requirements,
      'generate',
    )

    await this.jobDescriptionService.startProcessing(jobPositionId, {
      addCvs: dto.count,
      initialStage: 'generating',
    })

    const bgLog = jobLogger(this.logger, jobPositionId, userId)
    bgLog.info(
      {
        event: 'pipeline.generate.start',
        count: dto.count,
        format: dto.format,
        role: jobPosition.title,
        requirements: requirements.length,
      },
      'generate-and-ingest queued',
    )

    this.runWithPipelineGuard(
      bgLog,
      jobPositionId,
      'pipeline.generate.failed',
      () =>
        this.runGenerateAndIngest(
          bgLog,
          jobPositionId,
          jobPosition.title,
          requirements,
          dto,
        ),
    )

    return { queued: dto.count }
  }

  // Write-side of the SSE channel; consumers should use `subscribeToProgress()`.
  getProgressStream(jobPositionId: string): ReplaySubject<ProgressEvent> {
    if (!this.progressStreams.has(jobPositionId)) {
      this.progressStreams.set(
        jobPositionId,
        new ReplaySubject<ProgressEvent>(1),
      )
    }
    return this.progressStreams.get(jobPositionId)!
  }

  // SSE stream = DB seed + live ReplaySubject + heartbeat. Ownership enforced via findById.
  subscribeToProgress(
    userId: string,
    jobPositionId: string,
  ): Observable<ProgressEvent> {
    const seed$ = defer(() =>
      from(this.jobDescriptionService.findById(userId, jobPositionId)).pipe(
        map<
          Awaited<ReturnType<JobDescriptionService['findById']>>,
          ProgressEvent
        >((jp) => ({
          stage: (jp.currentStage ?? 'parsing') as ProgressStage,
          processed: jp.processedCvs,
          total: jp.totalCvs,
        })),
      ),
    )
    const live$ = this.getProgressStream(jobPositionId).asObservable()
    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map<number, ProgressEvent>(() => ({
        stage: 'heartbeat',
        processed: 0,
        total: 0,
      })),
    )
    return merge(concat(seed$, live$), heartbeat$)
  }

  async getProgressSnapshot(
    userId: string,
    jobPositionId: string,
  ): Promise<{
    status: string
    currentStage: string | null
    processedCvs: number
    totalCvs: number
  }> {
    const jp = await this.jobDescriptionService.findById(userId, jobPositionId)
    return {
      status: jp.status,
      currentStage: jp.currentStage,
      processedCvs: jp.processedCvs,
      totalCvs: jp.totalCvs,
    }
  }

  async processCVs(
    userId: string,
    jobPositionId: string,
    files: UploadedFile[],
  ): Promise<{ queued: number }> {
    const jobPosition = await this.jobDescriptionService.findById(
      userId,
      jobPositionId,
    )
    const requirements = this.ensureRequirements(
      jobPositionId,
      jobPosition.requirements,
      'upload',
    )

    await this.jobDescriptionService.startProcessing(jobPositionId, {
      addCvs: files.length,
    })

    const bgLog = jobLogger(this.logger, jobPositionId, userId)
    bgLog.info(
      { event: 'pipeline.upload.start', count: files.length },
      'upload pipeline queued',
    )

    this.runWithPipelineGuard(
      bgLog,
      jobPositionId,
      'pipeline.upload.failed',
      () => this.runPipeline(bgLog, jobPositionId, requirements, files),
    )

    return { queued: files.length }
  }

  private async runPipeline(
    log: PinoBaseLogger,
    jobPositionId: string,
    requirements: Requirement[],
    files: UploadedFile[],
  ): Promise<void> {
    const progress = this.getProgressStream(jobPositionId)

    const parseOp = startOp(log, 'pipeline.parsing', { total: files.length })
    progress.next({ stage: 'parsing', processed: 0, total: files.length })

    const parsedCVs = await Promise.all(
      files.map(async (file, index) => {
        const outcome = await this.parseFile(log, file)
        progress.next({
          stage: 'parsing',
          processed: index + 1,
          total: files.length,
        })
        return outcome
      }),
    )
    parseOp.ok({
      ok: parsedCVs.filter((p) => p.success).length,
      failed: parsedCVs.filter((p) => !p.success).length,
    })

    await this.jobDescriptionService.updateStage(jobPositionId, 'filtering')
    const filterOp = startOp(log, 'pipeline.filtering', { total: parsedCVs.length })
    progress.next({
      stage: 'filtering',
      processed: 0,
      total: parsedCVs.length,
    })

    const cvRecords: CvRecord[] = []
    for (let i = 0; i < parsedCVs.length; i++) {
      const record = await this.persistParsedOutcome(
        log,
        jobPositionId,
        parsedCVs[i],
        requirements,
      )
      if (record) cvRecords.push(record)
      progress.next({
        stage: 'filtering',
        processed: i + 1,
        total: parsedCVs.length,
      })
    }
    filterOp.ok({ persisted: cvRecords.length })

    await this.runScoringStage(log, jobPositionId, requirements, cvRecords)
  }

  // Each generated CV is persisted the moment its LLM call returns, so rows appear in the UI incrementally.
  private async runGenerateAndIngest(
    log: PinoBaseLogger,
    jobPositionId: string,
    jobTitle: string,
    requirements: Requirement[],
    dto: GenerateCVsDto,
  ): Promise<void> {
    const progress = this.getProgressStream(jobPositionId)
    const tiers = this.cvGeneratorService.buildTierArray(dto)
    const total = tiers.length

    const genOp = startOp(log, 'pipeline.generating', {
      total,
      concurrency: this.cvGeneratorService.cvGenerationConcurrencyLimit,
    })
    progress.next({ stage: 'generating', processed: 0, total })

    const limit = pLimit(
      this.cvGeneratorService.cvGenerationConcurrencyLimit,
    )
    let completed = 0

    const cvRecords = (
      await Promise.all(
        tiers.map((tier, i) =>
          limit(async () => {
            const generated = await this.cvGeneratorService.generateOne(
              log,
              tier,
              jobTitle,
              requirements,
              dto.format,
              i,
            )

            let record: CvRecord | null = null
            if (generated) {
              const outcome = await this.parseFile(log, {
                originalname: generated.filename,
                mimetype: generated.mimeType,
                buffer: generated.buffer,
              })
              record = await this.persistParsedOutcome(
                log,
                jobPositionId,
                outcome,
                requirements,
              )
            }

            completed++
            progress.next({ stage: 'generating', processed: completed, total })
            return record
          }),
        ),
      )
    ).filter((r): r is CvRecord => r !== null)

    genOp.ok({ ingested: cvRecords.length, requested: total })

    await this.runScoringStage(log, jobPositionId, requirements, cvRecords)
  }

  // Catch parser exceptions so the caller can persist a "parse failed" row and keep the pipeline moving.
  private async parseFile(
    log: PinoBaseLogger,
    file: UploadedFile,
  ): Promise<
    | { file: UploadedFile; parsed: ParsedCV; success: true }
    | { file: UploadedFile; parsed: null; success: false; reason: string }
  > {
    try {
      const parsed = await this.parserService.parse(
        file.buffer,
        file.originalname,
        file.mimetype,
      )
      return { file, parsed, success: true }
    } catch (err) {
      const reason = (err as Error).message || 'Unknown parse error'
      log.warn(
        {
          event: 'pipeline.parse_file.failed',
          err,
          filename: file.originalname,
          mimetype: file.mimetype,
        },
        'failed to parse file',
      )
      return { file, parsed: null, success: false, reason }
    }
  }

  private async persistParsedOutcome(
    log: PinoBaseLogger,
    jobPositionId: string,
    outcome:
      | { file: UploadedFile; parsed: ParsedCV; success: true }
      | { file: UploadedFile; parsed: null; success: false; reason: string },
    requirements: Requirement[],
  ): Promise<CvRecord | null> {
    if (!outcome.success || !outcome.parsed) {
      try {
        await this.resumeService.createFailed({
          jobPositionId,
          originalFilename: outcome.file.originalname,
          mimeType: outcome.file.mimetype,
          reason:
            'reason' in outcome && outcome.reason
              ? `Could not read file: ${outcome.reason}`
              : 'Could not read file.',
        })
      } catch (err) {
        log.error(
          {
            event: 'cv.ingest.db_failed',
            err,
            stage: 'parse_failed',
            filename: outcome.file.originalname,
          },
          'could not persist parse-failed CV row; skipping',
        )
        return null
      }
      log.warn(
        {
          event: 'cv.ingest.parse_failed',
          filename: outcome.file.originalname,
          reason: 'reason' in outcome ? outcome.reason : undefined,
        },
        'persisted parse-failed CV row',
      )
      return null
    }

    if (outcome.parsed.parsingConfidence === 'failed') {
      try {
        await this.resumeService.createFailed({
          jobPositionId,
          originalFilename: outcome.file.originalname,
          mimeType: outcome.file.mimetype,
          reason:
            outcome.parsed.parseError ??
            'Could not extract any text from this file.',
        })
      } catch (err) {
        log.error(
          {
            event: 'cv.ingest.db_failed',
            err,
            stage: 'empty_text',
            filename: outcome.file.originalname,
          },
          'could not persist empty-text CV row; skipping',
        )
        return null
      }
      log.warn(
        {
          event: 'cv.ingest.empty_text',
          filename: outcome.file.originalname,
          reason: outcome.parsed.parseError,
        },
        'persisted empty-text CV row',
      )
      return null
    }

    const anonymizedText = this.anonymizationService.anonymize(
      outcome.parsed.rawText,
    )
    const filterResult = this.filterService.filter(
      outcome.parsed,
      requirements,
    )

    let cv: CV
    try {
      cv = await this.resumeService.createFromParsed({
        jobPositionId,
        originalFilename: outcome.file.originalname,
        mimeType: outcome.file.mimetype,
        rawText: outcome.parsed.rawText,
        anonymizedText,
        sections: outcome.parsed.sections as unknown as object,
        sentences: outcome.parsed.sentences as unknown as object,
        entities: outcome.parsed.entities as unknown as object,
        parsingConfidence: outcome.parsed.parsingConfidence,
        keywordScores: filterResult.keywordScores as unknown as object,
        tier: filterResult.preliminaryTier,
        finalScore: filterResult.preliminaryScore,
        eliminationReason: filterResult.eliminationReason ?? null,
      })
    } catch (err) {
      log.error(
        {
          event: 'cv.ingest.db_failed',
          err,
          stage: 'create_from_parsed',
          filename: outcome.file.originalname,
          tier: filterResult.preliminaryTier,
        },
        'could not persist ingested CV row; skipping',
      )
      return null
    }

    log.debug(
      {
        event: 'cv.ingest.ok',
        cvId: cv.id,
        filename: outcome.file.originalname,
        tier: filterResult.preliminaryTier,
        preliminaryScore: filterResult.preliminaryScore,
        parsingConfidence: outcome.parsed.parsingConfidence,
      },
      'ingested CV',
    )

    return {
      id: cv.id,
      parsed: outcome.parsed,
      anonymizedText,
      keywordScores: filterResult.keywordScores,
      tier: filterResult.preliminaryTier,
    }
  }

  private async runScoringStage(
    log: PinoBaseLogger,
    jobPositionId: string,
    requirements: Requirement[],
    cvRecords: CvRecord[],
  ): Promise<void> {
    const progress = this.getProgressStream(jobPositionId)
    const aiCandidates = cvRecords.filter(
      (cv) => cv.tier === 'good' || cv.tier === 'great',
    )

    await this.jobDescriptionService.updateStage(jobPositionId, 'scoring')
    const scoringOp = startOp(log, 'pipeline.scoring', {
      candidates: aiCandidates.length,
      skipped: cvRecords.length - aiCandidates.length,
    })
    progress.next({
      stage: 'scoring',
      processed: 0,
      total: aiCandidates.length,
    })

    const scoreItems: ScoreBatchItem[] = aiCandidates.map((cv) => ({
      cvId: cv.id,
      cv: cv.parsed,
      anonymizedText: cv.anonymizedText,
      keywordScores: cv.keywordScores,
      tier: cv.tier,
    }))

    let totalAiCost = 0
    const aiResults = await this.aiService.scoreBatch(
      scoreItems,
      requirements,
      (done, tot) => progress.next({ stage: 'scoring', processed: done, total: tot }),
    )

    let scoringFailures = 0
    for (const result of aiResults) {
      totalAiCost += result.costUsd

      const cvRecord = cvRecords.find((c) => c.id === result.cvId)
      if (!cvRecord) continue

      const scoringResult = this.scoringService.computeFinalScore(
        requirements,
        cvRecord.keywordScores,
        result.aiScores,
      )

      try {
        await this.resumeService.applyAiScores(result.cvId, {
          aiScores: result.aiScores as unknown as object | null,
          modelUsed: result.modelUsed,
          costUsd: result.costUsd,
          finalScore: scoringResult.finalScore,
          tier: scoringResult.tier,
        })
      } catch (err) {
        scoringFailures++
        log.error(
          {
            event: 'cv.score_persist.failed',
            err,
            cvId: result.cvId,
            tier: scoringResult.tier,
          },
          'could not persist AI scores for CV; continuing with remaining CVs',
        )
      }
    }

    const summary = await this.resumeService.summarizeTiers(jobPositionId)
    await this.jobDescriptionService.completeProcessing(jobPositionId, {
      summary,
      aiCostDelta: totalAiCost,
    })

    scoringOp.ok({
      totalAiCostUsd: Number(totalAiCost.toFixed(4)),
      scoringFailures,
    })
    log.info(
      {
        event: 'pipeline.completed',
        summary,
        totalAiCostUsd: Number(totalAiCost.toFixed(4)),
        scoringFailures,
      },
      'pipeline completed',
    )

    progress.next({
      stage: 'completed',
      processed: summary.total,
      total: summary.total,
    })
    progress.complete()
    this.progressStreams.delete(jobPositionId)
  }

  async getResults(
    userId: string,
    jobPositionId: string,
  ): Promise<{
    jobPosition: Awaited<ReturnType<JobDescriptionService['findById']>>
    ranked: RankedResults
  }> {
    const jobPosition = await this.jobDescriptionService.findById(
      userId,
      jobPositionId,
    )
    const cvs = await this.resumeService.findAllByJobPosition(jobPositionId)
    const ranked = this.rankingService.rank(cvs)
    return { jobPosition, ranked }
  }

  // Override + re-sum tier counts so the denormalized summary on the positions table stays accurate.
  async overrideTier(
    userId: string,
    jobPositionId: string,
    cvId: string,
    newTier: CVTier,
  ): Promise<CV> {
    await this.jobDescriptionService.findById(userId, jobPositionId)
    const updated = await this.resumeService.overrideTier(
      cvId,
      jobPositionId,
      newTier,
    )
    const summary = await this.resumeService.summarizeTiers(jobPositionId)
    await this.jobDescriptionService.refreshTierCounts(jobPositionId, summary)
    this.logger.info(
      {
        event: 'cv.tier_override.ok',
        jobPositionId,
        userId,
        cvId,
        newTier,
      },
      'tier overridden by user',
    )
    return updated
  }

  // Skips parsing (uses stored parsed data) and re-runs filter + AI scoring after requirements edit.
  async rescoreExistingCvs(
    userId: string,
    jobPositionId: string,
  ): Promise<{ queued: number }> {
    const jobPosition = await this.jobDescriptionService.findById(
      userId,
      jobPositionId,
    )
    const requirements = this.ensureRequirements(
      jobPositionId,
      jobPosition.requirements,
      'rescore',
    )

    const cvs = await this.resumeService.findAllByJobPosition(jobPositionId)
    if (cvs.length === 0) return { queued: 0 }

    await this.jobDescriptionService.startProcessing(jobPositionId, {
      initialStage: 'filtering',
    })

    const bgLog = jobLogger(this.logger, jobPositionId, userId)
    bgLog.info(
      { event: 'pipeline.rescore.start', count: cvs.length },
      'rescore pipeline queued',
    )

    this.runWithPipelineGuard(
      bgLog,
      jobPositionId,
      'pipeline.rescore.failed',
      () => this.runRescorePipeline(bgLog, jobPositionId, requirements, cvs),
    )

    return { queued: cvs.length }
  }

  private async runRescorePipeline(
    log: PinoBaseLogger,
    jobPositionId: string,
    requirements: Requirement[],
    cvs: CV[],
  ): Promise<void> {
    const progress = this.getProgressStream(jobPositionId)

    progress.next({ stage: 'filtering', processed: 0, total: cvs.length })

    const filtered: Array<{
      id: string
      parsed: ParsedCV
      anonymizedText: string
      keywordScores: KeywordScores
      tier: CVTier
    }> = []

    for (let i = 0; i < cvs.length; i++) {
      const cv = cvs[i]

      // Keep parse-failed CVs as no-match; rescoring would overwrite the failure reason with empty text.
      if (cv.parsingConfidence === 'failed') {
        progress.next({ stage: 'filtering', processed: i + 1, total: cvs.length })
        continue
      }

      const parsed: ParsedCV = {
        rawText: cv.rawText,
        sections: cv.sections as unknown as ParsedCV['sections'],
        sentences: cv.sentences as unknown as string[],
        entities: cv.entities as unknown as ParsedCV['entities'],
        parsingConfidence:
          cv.parsingConfidence as unknown as ParsedCV['parsingConfidence'],
      }

      const filterResult = this.filterService.filter(parsed, requirements)

      try {
        await this.resumeService.applyFilterResults(cv.id, {
          keywordScores: filterResult.keywordScores as unknown as object,
          tier: filterResult.preliminaryTier,
          finalScore: filterResult.preliminaryScore,
          eliminationReason: filterResult.eliminationReason ?? null,
        })

        filtered.push({
          id: cv.id,
          parsed,
          anonymizedText: cv.anonymizedText,
          keywordScores: filterResult.keywordScores,
          tier: filterResult.preliminaryTier,
        })
      } catch (err) {
        log.error(
          {
            event: 'cv.rescore_persist.failed',
            err,
            cvId: cv.id,
            tier: filterResult.preliminaryTier,
          },
          'could not persist rescore filter result; CV will not be re-scored by AI',
        )
      }

      progress.next({ stage: 'filtering', processed: i + 1, total: cvs.length })
    }

    await this.runScoringStage(log, jobPositionId, requirements, filtered)
  }
}
