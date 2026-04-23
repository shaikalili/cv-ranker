import { Test, TestingModule } from '@nestjs/testing'
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { getLoggerToken } from 'nestjs-pino'

import { JobPositionService } from '../../../src/job-position/job-position.service'
import { ParserService } from '../../../src/parser/parser.service'
import { AnonymizationService } from '../../../src/anonymization/anonymization.service'
import { FilterService } from '../../../src/filter/filter.service'
import { AiService } from '../../../src/ai/ai.service'
import { ScoringService } from '../../../src/scoring/scoring.service'
import { RankingService } from '../../../src/scoring/ranking.service'
import { JobDescriptionService } from '../../../src/job-description/job-description.service'
import { CvGeneratorService } from '../../../src/cv-generator/cv-generator.service'
import { ResumeService } from '../../../src/resume/resume.service'
import {
  makeCvRow,
  makeParsedCV,
  makeRequirement,
} from '../../helpers/factories'

/**
 * Thin PinoLogger double compatible with both the `nestjs-pino` wrapper and
 * the `common/logging.ts` helpers (they reach for `.logger` first, then fall
 * back to the instance itself — we only expose the instance).
 */
function makeLogger() {
  const fns = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  }
  return {
    ...fns,
    child: jest.fn(() => ({ ...fns, child: jest.fn() })),
    setContext: jest.fn(),
  }
}

/**
 * `runWithPipelineGuard` is fire-and-forget — the foreground call returns
 * before the pipeline is done. Tests hook a promise into one of the mocked
 * terminal methods (`completeProcessing` for success, `markFailed` for
 * failure) so we can `await` the actual termination.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('JobPositionService', () => {
  // Collaborators. All methods are jest.fn() so each test programs only what
  // it needs; unused methods stay `undefined` and never get invoked because
  // the code paths they belong to aren't reached.
  let parser: { parse: jest.Mock }
  let anonymization: { anonymize: jest.Mock }
  let filter: { filter: jest.Mock }
  let ai: { scoreBatch: jest.Mock }
  let scoring: { computeFinalScore: jest.Mock }
  let ranking: { rank: jest.Mock }
  let jobDesc: {
    findById: jest.Mock
    startProcessing: jest.Mock
    updateStage: jest.Mock
    completeProcessing: jest.Mock
    markFailed: jest.Mock
    refreshTierCounts: jest.Mock
  }
  let cvGenerator: {
    buildTierArray: jest.Mock
    generateOne: jest.Mock
    cvGenerationConcurrencyLimit: number
  }
  let resume: {
    findById: jest.Mock
    findAllByJobPosition: jest.Mock
    createFailed: jest.Mock
    createFromParsed: jest.Mock
    applyAiScores: jest.Mock
    applyFilterResults: jest.Mock
    summarizeTiers: jest.Mock
    overrideTier: jest.Mock
  }

  let service: JobPositionService

  beforeEach(async () => {
    parser = { parse: jest.fn() }
    anonymization = { anonymize: jest.fn((s: string) => s) }
    filter = { filter: jest.fn() }
    ai = { scoreBatch: jest.fn() }
    scoring = { computeFinalScore: jest.fn() }
    ranking = { rank: jest.fn() }
    jobDesc = {
      findById: jest.fn(),
      startProcessing: jest.fn().mockResolvedValue(undefined),
      updateStage: jest.fn().mockResolvedValue(undefined),
      completeProcessing: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      refreshTierCounts: jest.fn().mockResolvedValue(undefined),
    }
    cvGenerator = {
      buildTierArray: jest.fn(),
      generateOne: jest.fn(),
      cvGenerationConcurrencyLimit: 2,
    }
    resume = {
      findById: jest.fn(),
      findAllByJobPosition: jest.fn(),
      createFailed: jest.fn(),
      createFromParsed: jest.fn(),
      applyAiScores: jest.fn().mockResolvedValue(undefined),
      applyFilterResults: jest.fn().mockResolvedValue(undefined),
      summarizeTiers: jest
        .fn()
        .mockResolvedValue({ great: 0, good: 0, noMatch: 0, total: 0 }),
      overrideTier: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobPositionService,
        { provide: ParserService, useValue: parser },
        { provide: AnonymizationService, useValue: anonymization },
        { provide: FilterService, useValue: filter },
        { provide: AiService, useValue: ai },
        { provide: ScoringService, useValue: scoring },
        { provide: RankingService, useValue: ranking },
        { provide: JobDescriptionService, useValue: jobDesc },
        { provide: CvGeneratorService, useValue: cvGenerator },
        { provide: ResumeService, useValue: resume },
        {
          provide: getLoggerToken(JobPositionService.name),
          useValue: makeLogger(),
        },
      ],
    }).compile()

    service = module.get(JobPositionService)
  })

  describe('ensureRequirements guard (via processCVs)', () => {
    const file = {
      originalname: 'cv.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('x'),
    }

    it('throws BadRequestException when requirements column is empty', async () => {
      jobDesc.findById.mockResolvedValue({
        id: 'job-1',
        title: 'Eng',
        requirements: [],
      })

      await expect(
        service.processCVs('u1', 'job-1', [file]),
      ).rejects.toThrow(BadRequestException)

      // Must abort before touching the pipeline.
      expect(jobDesc.startProcessing).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when requirements is not an array', async () => {
      jobDesc.findById.mockResolvedValue({
        id: 'job-1',
        title: 'Eng',
        requirements: null,
      })

      await expect(
        service.processCVs('u1', 'job-1', [file]),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws UnprocessableEntityException when a requirement entry is malformed', async () => {
      jobDesc.findById.mockResolvedValue({
        id: 'job-1',
        title: 'Eng',
        // Missing `keywords` / `synonyms` on the second entry.
        requirements: [
          makeRequirement({ id: 'r1' }),
          { id: 'r2', text: 'broken' },
        ],
      })

      await expect(
        service.processCVs('u1', 'job-1', [file]),
      ).rejects.toThrow(UnprocessableEntityException)
    })
  })

  describe('processCVs happy path', () => {
    const reqs = [makeRequirement({ id: 'r1', isRequired: true })]
    const file = {
      originalname: 'alice.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('x'),
    }

    beforeEach(() => {
      jobDesc.findById.mockResolvedValue({
        id: 'job-1',
        title: 'Eng',
        requirements: reqs,
      })
      parser.parse.mockResolvedValue(makeParsedCV())
      filter.filter.mockReturnValue({
        keywordScores: { r1: { matchedSentences: [], rawScore: 1 } },
        preliminaryTier: 'good',
        preliminaryScore: 70,
        missingRequiredCount: 0,
      })
      resume.createFromParsed.mockResolvedValue(makeCvRow({ id: 'cv-1' }))
      ai.scoreBatch.mockResolvedValue([
        {
          cvId: 'cv-1',
          aiScores: { scores: [], overallSummary: '' },
          modelUsed: 'gpt-5-mini',
          costUsd: 0.01,
        },
      ])
      scoring.computeFinalScore.mockReturnValue({
        finalScore: 75,
        tier: 'good',
        missingRequiredCount: 0,
      })
      resume.summarizeTiers.mockResolvedValue({
        great: 0,
        good: 1,
        noMatch: 0,
        total: 1,
      })
    })

    it('runs the full pipeline: parse → filter → persist → AI score → complete', async () => {
      const done = deferred()
      jobDesc.completeProcessing.mockImplementation(async () => done.resolve())

      const result = await service.processCVs('u1', 'job-1', [file])
      expect(result).toEqual({ queued: 1 })
      await done.promise

      expect(parser.parse).toHaveBeenCalledTimes(1)
      expect(resume.createFromParsed).toHaveBeenCalledTimes(1)
      expect(ai.scoreBatch).toHaveBeenCalledTimes(1)
      expect(resume.applyAiScores).toHaveBeenCalledWith('cv-1', expect.objectContaining({
        modelUsed: 'gpt-5-mini',
        finalScore: 75,
        tier: 'good',
      }))
      expect(jobDesc.completeProcessing).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          summary: expect.objectContaining({ total: 1 }),
        }),
      )
    })

    it('skips AI scoring for no-match CVs (filter stage eliminates them)', async () => {
      filter.filter.mockReturnValue({
        keywordScores: {},
        preliminaryTier: 'no-match',
        preliminaryScore: 20,
        missingRequiredCount: 3,
        eliminationReason: 'missing Node.js + K8s + AWS',
      })
      resume.createFromParsed.mockResolvedValue(makeCvRow({ id: 'cv-1', tier: 'no-match' }))
      // scoreBatch should get an empty candidate list.
      ai.scoreBatch.mockResolvedValue([])
      resume.summarizeTiers.mockResolvedValue({ great: 0, good: 0, noMatch: 1, total: 1 })

      const done = deferred()
      jobDesc.completeProcessing.mockImplementation(async () => done.resolve())

      await service.processCVs('u1', 'job-1', [file])
      await done.promise

      expect(ai.scoreBatch).toHaveBeenCalledWith(
        [], // no candidates
        reqs,
        expect.any(Function),
      )
      expect(resume.applyAiScores).not.toHaveBeenCalled()
    })
  })

  describe('persistParsedOutcome DB resilience', () => {
    const reqs = [makeRequirement({ id: 'r1', isRequired: true })]
    const file = {
      originalname: 'bad.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('x'),
    }

    beforeEach(() => {
      jobDesc.findById.mockResolvedValue({
        id: 'job-1',
        title: 'Eng',
        requirements: reqs,
      })
      ai.scoreBatch.mockResolvedValue([])
      resume.summarizeTiers.mockResolvedValue({
        great: 0,
        good: 0,
        noMatch: 0,
        total: 0,
      })
    })

    it('swallows a createFailed DB error and continues the pipeline (parse threw)', async () => {
      parser.parse.mockRejectedValue(new Error('corrupt pdf'))
      resume.createFailed.mockRejectedValue(new Error('DB down'))

      const done = deferred()
      jobDesc.completeProcessing.mockImplementation(async () => done.resolve())

      await service.processCVs('u1', 'job-1', [file])
      await done.promise

      // The DB error on createFailed did NOT propagate: the whole pipeline
      // still made it to completeProcessing. Previously this would have
      // taken down the entire batch.
      expect(resume.createFailed).toHaveBeenCalledTimes(1)
      expect(jobDesc.completeProcessing).toHaveBeenCalled()
      expect(jobDesc.markFailed).not.toHaveBeenCalled()
    })

    it('swallows a createFromParsed DB error for one file while another succeeds', async () => {
      parser.parse.mockResolvedValue(makeParsedCV())
      filter.filter.mockReturnValue({
        keywordScores: {},
        preliminaryTier: 'good',
        preliminaryScore: 70,
        missingRequiredCount: 0,
      })
      resume.createFromParsed
        .mockRejectedValueOnce(new Error('unique constraint'))
        .mockResolvedValueOnce(makeCvRow({ id: 'cv-ok' }))
      ai.scoreBatch.mockResolvedValue([])

      const done = deferred()
      jobDesc.completeProcessing.mockImplementation(async () => done.resolve())

      await service.processCVs('u1', 'job-1', [
        { ...file, originalname: 'a.pdf' },
        { ...file, originalname: 'b.pdf' },
      ])
      await done.promise

      expect(resume.createFromParsed).toHaveBeenCalledTimes(2)
      expect(jobDesc.completeProcessing).toHaveBeenCalled()
      expect(jobDesc.markFailed).not.toHaveBeenCalled()
    })
  })

  describe('runScoringStage resilience', () => {
    const reqs = [makeRequirement({ id: 'r1', isRequired: true })]
    const file = {
      originalname: 'x.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('x'),
    }

    it('counts applyAiScores failures but keeps finalising the pipeline', async () => {
      jobDesc.findById.mockResolvedValue({
        id: 'job-1',
        title: 'Eng',
        requirements: reqs,
      })
      parser.parse.mockResolvedValue(makeParsedCV())
      filter.filter.mockReturnValue({
        keywordScores: { r1: { matchedSentences: [], rawScore: 1 } },
        preliminaryTier: 'good',
        preliminaryScore: 70,
        missingRequiredCount: 0,
      })
      resume.createFromParsed.mockResolvedValue(makeCvRow({ id: 'cv-1' }))
      ai.scoreBatch.mockResolvedValue([
        {
          cvId: 'cv-1',
          aiScores: { scores: [], overallSummary: '' },
          modelUsed: 'gpt-5-mini',
          costUsd: 0.01,
        },
      ])
      scoring.computeFinalScore.mockReturnValue({
        finalScore: 75,
        tier: 'good',
        missingRequiredCount: 0,
      })
      resume.applyAiScores.mockRejectedValue(new Error('row locked'))
      resume.summarizeTiers.mockResolvedValue({ great: 0, good: 1, noMatch: 0, total: 1 })

      const done = deferred()
      jobDesc.completeProcessing.mockImplementation(async () => done.resolve())

      await service.processCVs('u1', 'job-1', [file])
      await done.promise

      // applyAiScores threw — but the pipeline still called completeProcessing.
      expect(resume.applyAiScores).toHaveBeenCalled()
      expect(jobDesc.completeProcessing).toHaveBeenCalled()
      expect(jobDesc.markFailed).not.toHaveBeenCalled()
    })
  })

  describe('runWithPipelineGuard (failure path)', () => {
    const reqs = [makeRequirement({ id: 'r1' })]

    it('marks the job FAILED when an unexpected error escapes the pipeline', async () => {
      jobDesc.findById.mockResolvedValue({
        id: 'job-1',
        title: 'Eng',
        requirements: reqs,
      })
      parser.parse.mockResolvedValue(makeParsedCV())
      filter.filter.mockReturnValue({
        keywordScores: {},
        preliminaryTier: 'good',
        preliminaryScore: 70,
        missingRequiredCount: 0,
      })
      resume.createFromParsed.mockResolvedValue(makeCvRow({ id: 'cv-1' }))
      // `updateStage` is called after the parsing stage — blowing up there
      // exercises the outer guard, which is the "something unexpected
      // happened" safety net.
      jobDesc.updateStage.mockRejectedValue(new Error('db connection lost'))

      const failed = deferred()
      jobDesc.markFailed.mockImplementation(async () => failed.resolve())

      await service.processCVs('u1', 'job-1', [
        {
          originalname: 'a.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('x'),
        },
      ])
      await failed.promise

      expect(jobDesc.markFailed).toHaveBeenCalledWith('job-1')
      expect(jobDesc.completeProcessing).not.toHaveBeenCalled()
    })
  })

  describe('overrideTier', () => {
    it('delegates with the new (cvId, jobPositionId, tier) signature and refreshes counts', async () => {
      jobDesc.findById.mockResolvedValue({ id: 'job-1', userId: 'u1' })
      const updated = makeCvRow({ id: 'cv-1', tier: 'great' })
      resume.overrideTier.mockResolvedValue(updated)
      resume.summarizeTiers.mockResolvedValue({
        great: 1,
        good: 0,
        noMatch: 0,
        total: 1,
      })

      const result = await service.overrideTier('u1', 'job-1', 'cv-1', 'great')

      expect(jobDesc.findById).toHaveBeenCalledWith('u1', 'job-1')
      expect(resume.overrideTier).toHaveBeenCalledWith('cv-1', 'job-1', 'great')
      expect(jobDesc.refreshTierCounts).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ great: 1, total: 1 }),
      )
      expect(result).toBe(updated)
    })

    it('surfaces NotFoundException from the resume layer (cross-entity check)', async () => {
      jobDesc.findById.mockResolvedValue({ id: 'job-1', userId: 'u1' })
      resume.overrideTier.mockRejectedValue(
        new NotFoundException('CV cv-foreign not found on job position job-1'),
      )

      await expect(
        service.overrideTier('u1', 'job-1', 'cv-foreign', 'great'),
      ).rejects.toThrow(NotFoundException)

      // Counts must NOT be refreshed when the update failed.
      expect(jobDesc.refreshTierCounts).not.toHaveBeenCalled()
    })

    it('rejects when the user does not own the job position', async () => {
      jobDesc.findById.mockRejectedValue(new NotFoundException('nope'))

      await expect(
        service.overrideTier('u2', 'job-1', 'cv-1', 'great'),
      ).rejects.toThrow(NotFoundException)

      expect(resume.overrideTier).not.toHaveBeenCalled()
    })
  })
})
