import { Injectable, NotFoundException } from '@nestjs/common'
import { CV, Prisma } from '@prisma/client'

import { PrismaService } from '../common/prisma/prisma.service'
import { CVTier } from '../common/types'

export interface CreateCvInput {
  jobPositionId: string
  originalFilename: string
  mimeType: string
  rawText: string
  anonymizedText: string
  sections: object
  sentences: object
  entities: object
  parsingConfidence: string
  keywordScores: object
  tier: CVTier
  finalScore: number
  eliminationReason: string | null
}

export interface ApplyFilterResultsInput {
  keywordScores: object
  tier: CVTier
  finalScore: number
  eliminationReason: string | null
}

export interface ApplyAiScoresInput {
  aiScores: object | null
  modelUsed: string
  costUsd: number
  finalScore: number
  tier: CVTier
}

export interface TierSummary {
  great: number
  good: number
  noMatch: number
  total: number
}

export interface CreateFailedCvInput {
  jobPositionId: string
  originalFilename: string
  mimeType: string
  reason: string
}

@Injectable()
export class ResumeService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<CV> {
    const cv = await this.prisma.cV.findUnique({ where: { id } })
    if (!cv) {
      throw new NotFoundException(`CV ${id} not found`)
    }
    return cv
  }

  findAllByJobPosition(jobPositionId: string): Promise<CV[]> {
    return this.prisma.cV.findMany({
      where: { jobPositionId },
      orderBy: { finalScore: 'desc' },
    })
  }

  // Persists a 'failed' CV row with the same shape as a success so UI/rescore don't need null checks.
  createFailed(input: CreateFailedCvInput): Promise<CV> {
    const emptySections: Prisma.InputJsonValue = {
      experience: '',
      skills: '',
      education: '',
      summary: '',
      other: '',
    }
    const emptyEntities: Prisma.InputJsonValue = {
      yearsOfExperience: 0,
      technologies: [],
      degrees: [],
      companies: [],
      roles: [],
    }
    return this.prisma.cV.create({
      data: {
        jobPositionId: input.jobPositionId,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        rawText: '',
        anonymizedText: '',
        sections: emptySections,
        sentences: [] as Prisma.InputJsonValue,
        entities: emptyEntities,
        parsingConfidence: 'failed',
        keywordScores: {} as Prisma.InputJsonValue,
        tier: 'no-match',
        finalScore: 0,
        eliminationReason: input.reason,
      },
    })
  }

  createFromParsed(input: CreateCvInput): Promise<CV> {
    return this.prisma.cV.create({
      data: {
        jobPositionId: input.jobPositionId,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        rawText: input.rawText,
        anonymizedText: input.anonymizedText,
        sections: input.sections as Prisma.InputJsonValue,
        sentences: input.sentences as Prisma.InputJsonValue,
        entities: input.entities as Prisma.InputJsonValue,
        parsingConfidence: input.parsingConfidence,
        keywordScores: input.keywordScores as Prisma.InputJsonValue,
        tier: input.tier,
        finalScore: input.finalScore,
        eliminationReason: input.eliminationReason,
      },
    })
  }

  // Rescore path: rewrite filter columns and clear stale AI scores.
  async applyFilterResults(
    cvId: string,
    input: ApplyFilterResultsInput,
  ): Promise<void> {
    await this.prisma.cV.update({
      where: { id: cvId },
      data: {
        keywordScores: input.keywordScores as Prisma.InputJsonValue,
        tier: input.tier,
        finalScore: input.finalScore,
        eliminationReason: input.eliminationReason,
        aiScores: Prisma.JsonNull,
        aiModelUsed: null,
        aiCostUsd: 0,
      },
    })
  }

  async applyAiScores(
    cvId: string,
    input: ApplyAiScoresInput,
  ): Promise<void> {
    await this.prisma.cV.update({
      where: { id: cvId },
      data: {
        // undefined = leave previous value untouched if the AI call produced nothing.
        aiScores:
          input.aiScores === null
            ? undefined
            : (input.aiScores as Prisma.InputJsonValue),
        aiModelUsed: input.modelUsed,
        aiCostUsd: input.costUsd,
        finalScore: input.finalScore,
        tier: input.tier,
      },
    })
  }

  // Cross-entity ownership guard: prevents tier-override on a CV that belongs to someone else's job position.
  async overrideTier(
    cvId: string,
    jobPositionId: string,
    newTier: CVTier,
  ): Promise<CV> {
    const existing = await this.prisma.cV.findFirst({
      where: { id: cvId, jobPositionId },
      select: { id: true },
    })
    if (!existing) {
      throw new NotFoundException(
        `CV ${cvId} not found on job position ${jobPositionId}`,
      )
    }
    return this.prisma.cV.update({
      where: { id: cvId },
      data: { tier: newTier, eliminationReason: null },
    })
  }

  async summarizeTiers(jobPositionId: string): Promise<TierSummary> {
    const cvs = await this.prisma.cV.findMany({
      where: { jobPositionId },
      select: { tier: true },
    })
    const summary: TierSummary = {
      great: 0,
      good: 0,
      noMatch: 0,
      total: cvs.length,
    }
    for (const cv of cvs) {
      if (cv.tier === 'great') summary.great += 1
      else if (cv.tier === 'good') summary.good += 1
      else summary.noMatch += 1
    }
    return summary
  }
}
