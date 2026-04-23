import { Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'
import OpenAI from 'openai'
import pLimit from 'p-limit'

import {
  AIScoreResponse,
  CVTier,
  KeywordScores,
  ParsedCV,
  Requirement,
} from '../common/types'
import { startOp } from '../common/logging'
import {
  EXTRACT_REQUIREMENTS_SYSTEM_PROMPT,
  buildExtractRequirementsUserPrompt,
} from './prompts/extract-requirements.prompt'
import {
  SCORING_SYSTEM_PROMPT,
  buildScoringUserPrompt,
} from './prompts/scoring.prompt'
import {
  GENERATE_CV_SYSTEM_PROMPT,
  buildGenerateCvUserPrompt,
} from './prompts/generate-cv.prompt'
import { CVQualityTier } from '../cv-generator/dto/generate-cvs.dto'
import { GeneratedCvContent } from '../cv-generator/dto/generated-cv-content'

export interface ScoreBatchItem {
  cvId: string
  cv: ParsedCV
  anonymizedText: string
  keywordScores: KeywordScores
  tier: CVTier
}

export interface ScoreBatchResult {
  cvId: string
  aiScores: AIScoreResponse | null
  modelUsed: string
  costUsd: number
  error?: string
}

@Injectable()
export class AiService implements OnModuleInit {
  private openai!: OpenAI

  private modelCheap!: string
  private modelPremium!: string
  private concurrencyLimit!: number

  constructor(
    private readonly configService: ConfigService,
    @InjectPinoLogger(AiService.name)
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured')
    }
    this.openai = new OpenAI({ apiKey })

    this.modelCheap = this.configService.get<string>(
      'AI_MODEL_CHEAP',
      'gpt-5-mini',
    )
    this.modelPremium = this.configService.get<string>(
      'AI_MODEL_PREMIUM',
      'gpt-5.1',
    )
    this.concurrencyLimit = Number(
      this.configService.get<string>('AI_CONCURRENCY_LIMIT', '5'),
    )
  }

  async extractRequirements(
    jdText: string,
  ): Promise<{ requirements: Requirement[]; costUsd: number }> {
    const op = startOp(this.logger, 'ai.extract_requirements', {
      model: this.modelCheap,
      jdChars: jdText.length,
    })

    try {
      const response = await this.callWithRetry(
        this.modelCheap,
        EXTRACT_REQUIREMENTS_SYSTEM_PROMPT,
        buildExtractRequirementsUserPrompt(jdText),
      )
      this.logger.trace({ event: 'ai.extract_requirements.raw', raw: response.content })

      const parsed = this.safeParseJson<{
        requirements: Array<Omit<Requirement, 'id'>>
      }>(response.content, 'ai.extract_requirements')

      if (
        !parsed ||
        !Array.isArray(parsed.requirements) ||
        parsed.requirements.length === 0
      ) {
        this.logger.error(
          {
            event: 'ai.extract_requirements.invalid_schema',
            hasParsed: !!parsed,
            hasArray: Array.isArray(parsed?.requirements),
          },
          'LLM returned no usable requirements',
        )
        throw new Error('AI returned no usable requirements')
      }

      const requirements: Requirement[] = parsed.requirements
        .filter(
          (r): r is Omit<Requirement, 'id'> =>
            !!r &&
            typeof r === 'object' &&
            typeof (r as Omit<Requirement, 'id'>).text === 'string' &&
            Array.isArray((r as Omit<Requirement, 'id'>).keywords),
        )
        .map((r, i) => ({
          ...r,
          synonyms: Array.isArray(r.synonyms) ? r.synonyms : [],
          id: `req_${i + 1}`,
        }))

      if (requirements.length === 0) {
        throw new Error(
          'AI returned requirements but none passed schema validation',
        )
      }

      const costUsd = this.estimateCost(this.modelCheap, response.usage)

      op.ok({
        n: requirements.length,
        dropped: parsed.requirements.length - requirements.length,
        costUsd,
        promptTok: response.usage.promptTokens,
        completionTok: response.usage.completionTokens,
      })
      return { requirements, costUsd }
    } catch (err) {
      op.fail(err)
      throw err
    }
  }

  // Occasional truncated-mid-object responses slip past response_format: json_object; log + return null instead of throwing.
  private safeParseJson<T>(raw: string, op: string): T | null {
    try {
      return JSON.parse(raw) as T
    } catch (err) {
      this.logger.error(
        {
          event: `${op}.parse_failed`,
          err,
          rawHead: raw.slice(0, 200),
          rawLength: raw.length,
        },
        'failed to parse LLM JSON response',
      )
      return null
    }
  }

  async generateCvContent(input: {
    jobTitle: string
    tier: CVQualityTier
    requirements: Requirement[]
  }): Promise<{
    content: GeneratedCvContent
    costUsd: number
    modelUsed: string
  }> {
    const model = this.modelCheap
    const op = startOp(this.logger, 'ai.generate_cv', {
      model,
      tier: input.tier,
      jobTitle: input.jobTitle,
      requirements: input.requirements.length,
    })

    try {
      const response = await this.callWithRetry(
        model,
        GENERATE_CV_SYSTEM_PROMPT,
        buildGenerateCvUserPrompt(input),
      )
      this.logger.trace({ event: 'ai.generate_cv.raw', raw: response.content })

      const parsed =
        this.safeParseJson<Partial<GeneratedCvContent>>(
          response.content,
          'ai.generate_cv',
        ) ?? {}
      const content = this.sanitizeGeneratedCv(parsed)
      const costUsd = this.estimateCost(model, response.usage)

      op.ok({
        costUsd,
        promptTok: response.usage.promptTokens,
        completionTok: response.usage.completionTokens,
      })
      return { content, costUsd, modelUsed: model }
    } catch (err) {
      op.fail(err)
      throw err
    }
  }

  // Never crash the PDF renderer on a missing field — fall back so a partial response still produces a document.
  private sanitizeGeneratedCv(
    raw: Partial<GeneratedCvContent>,
  ): GeneratedCvContent {
    const currentYear = new Date().getFullYear()
    const clampYear = (y: unknown): number => {
      const n = typeof y === 'number' ? y : Number(y)
      if (!Number.isFinite(n)) return currentYear
      return Math.max(1990, Math.min(currentYear, Math.floor(n)))
    }

    const experience = Array.isArray(raw.experience)
      ? raw.experience.map((e) => {
          const startYear = clampYear(e?.startYear)
          const endYearCandidate = clampYear(e?.endYear)
          return {
            company: String(e?.company ?? '').trim() || 'Unknown Company',
            role: String(e?.role ?? '').trim() || 'Engineer',
            startYear,
            endYear: Math.max(startYear, endYearCandidate),
            bullets: Array.isArray(e?.bullets)
              ? e.bullets.map((b) => String(b ?? '').trim()).filter(Boolean)
              : [],
          }
        })
      : []

    return {
      name: String(raw.name ?? '').trim() || 'Candidate',
      email: String(raw.email ?? '').trim() || 'candidate@example.com',
      yearsExperience:
        typeof raw.yearsExperience === 'number' && raw.yearsExperience >= 0
          ? Math.floor(raw.yearsExperience)
          : 0,
      summary: String(raw.summary ?? '').trim(),
      experience,
      skills: Array.isArray(raw.skills)
        ? raw.skills.map((s) => String(s ?? '').trim()).filter(Boolean)
        : [],
      education: String(raw.education ?? '').trim(),
    }
  }

  async scoreBatch(
    items: ScoreBatchItem[],
    requirements: Requirement[],
    onProgress?: (completed: number, total: number) => void,
  ): Promise<ScoreBatchResult[]> {
    const limit = pLimit(this.concurrencyLimit)
    let completed = 0

    const results = await Promise.all(
      items.map((item) =>
        limit(async () => {
          const result = await this.scoreSingle(item, requirements)
          completed++
          onProgress?.(completed, items.length)
          return result
        }),
      ),
    )

    return results
  }

  private async scoreSingle(
    item: ScoreBatchItem,
    requirements: Requirement[],
  ): Promise<ScoreBatchResult> {
    const model = item.tier === 'great' ? this.modelPremium : this.modelCheap

    try {
      const response = await this.callWithRetry(
        model,
        SCORING_SYSTEM_PROMPT,
        buildScoringUserPrompt(
          item.cv,
          item.anonymizedText,
          requirements,
          item.keywordScores,
        ),
      )

      const parsed = this.safeParseJson<AIScoreResponse>(
        response.content,
        'ai.score_cv',
      )
      if (!parsed) {
        return {
          cvId: item.cvId,
          aiScores: null,
          modelUsed: model,
          costUsd: this.estimateCost(model, response.usage),
          error: 'AI response was not valid JSON',
        }
      }

      return {
        cvId: item.cvId,
        aiScores: parsed,
        modelUsed: model,
        costUsd: this.estimateCost(model, response.usage),
      }
    } catch (err) {
      this.logger.error(
        {
          event: 'ai.score_cv.failed',
          err,
          cvId: item.cvId,
          tier: item.tier,
          model,
        },
        'failed to score CV',
      )
      return {
        cvId: item.cvId,
        aiScores: null,
        modelUsed: model,
        costUsd: 0,
        error: (err as Error).message,
      }
    }
  }

  private async callWithRetry(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    retries = 2,
  ): Promise<{
    content: string
    usage: { promptTokens: number; completionTokens: number }
  }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        })

        const content = response.choices[0]?.message?.content
        if (!content) {
          throw new Error('Empty response from model')
        }

        return {
          content,
          usage: {
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
          },
        }
      } catch (err) {
        if (attempt === retries) throw err
        const delayMs = 1000 * Math.pow(2, attempt)
        this.logger.warn(
          {
            event: 'ai.call.retry',
            err,
            model,
            attempt: attempt + 1,
            nextRetryMs: delayMs,
          },
          `AI call failed, retrying`,
        )
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
    throw new Error('Unreachable')
  }

  // Prices are per 1M tokens; update if OpenAI pricing changes.
  private estimateCost(
    model: string,
    usage: { promptTokens: number; completionTokens: number },
  ): number {
    const rates: Record<string, { input: number; output: number }> = {
      'gpt-5-mini': { input: 0.25, output: 2.0 },
      'gpt-5.1': { input: 1.25, output: 10.0 },
      'gpt-5': { input: 0.625, output: 5.0 },
    }

    const rate = rates[model] ?? rates['gpt-5-mini']
    const inputCost = (usage.promptTokens / 1_000_000) * rate.input
    const outputCost = (usage.completionTokens / 1_000_000) * rate.output
    return inputCost + outputCost
  }
}
