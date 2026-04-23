import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'

import { ResumeService } from '../../../src/resume/resume.service'
import { PrismaService } from '../../../src/common/prisma/prisma.service'
import { makeCvRow } from '../../helpers/factories'

/**
 * Minimal `PrismaService` double — we only stub the `cV` delegate because
 * `ResumeService` never touches `jobPosition` or any other model. Each
 * method is a `jest.fn()` so individual tests can program the return shape
 * they need.
 */
function makePrismaMock() {
  return {
    cV: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  }
}

describe('ResumeService', () => {
  let service: ResumeService
  let prisma: ReturnType<typeof makePrismaMock>

  beforeEach(async () => {
    prisma = makePrismaMock()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResumeService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()
    service = module.get(ResumeService)
  })

  describe('findById', () => {
    it('returns the CV when it exists', async () => {
      const row = makeCvRow()
      prisma.cV.findUnique.mockResolvedValue(row)

      await expect(service.findById(row.id)).resolves.toBe(row)
      expect(prisma.cV.findUnique).toHaveBeenCalledWith({ where: { id: row.id } })
    })

    it('throws NotFoundException when missing', async () => {
      prisma.cV.findUnique.mockResolvedValue(null)
      await expect(service.findById('ghost')).rejects.toThrow(NotFoundException)
    })
  })

  describe('overrideTier — cross-entity ownership', () => {
    it('updates when CV belongs to the claimed job position', async () => {
      prisma.cV.findFirst.mockResolvedValue({ id: 'cv-1' })
      prisma.cV.update.mockResolvedValue(
        makeCvRow({ id: 'cv-1', tier: 'great', eliminationReason: null }),
      )

      const result = await service.overrideTier('cv-1', 'job-1', 'great')

      expect(prisma.cV.findFirst).toHaveBeenCalledWith({
        where: { id: 'cv-1', jobPositionId: 'job-1' },
        select: { id: true },
      })
      expect(prisma.cV.update).toHaveBeenCalledWith({
        where: { id: 'cv-1' },
        data: { tier: 'great', eliminationReason: null },
      })
      expect(result.tier).toBe('great')
    })

    it('refuses when CV does not belong to the claimed job position', async () => {
      // Simulating the "User A owns Job B; tries to flip a CV from Job C" case
      prisma.cV.findFirst.mockResolvedValue(null)

      await expect(
        service.overrideTier('cv-foreign', 'job-1', 'great'),
      ).rejects.toThrow(NotFoundException)

      // Critical: we must NOT call update if ownership didn't check out.
      expect(prisma.cV.update).not.toHaveBeenCalled()
    })

    it('refuses for an entirely bogus cvId (no silent Prisma P2025)', async () => {
      prisma.cV.findFirst.mockResolvedValue(null)
      await expect(
        service.overrideTier('does-not-exist', 'job-1', 'good'),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('summarizeTiers', () => {
    it('counts tiers and returns a total', async () => {
      prisma.cV.findMany.mockResolvedValue([
        { tier: 'great' },
        { tier: 'great' },
        { tier: 'good' },
        { tier: 'no-match' },
        { tier: null },
      ])

      const summary = await service.summarizeTiers('job-1')

      expect(summary).toEqual({ great: 2, good: 1, noMatch: 2, total: 5 })
      expect(prisma.cV.findMany).toHaveBeenCalledWith({
        where: { jobPositionId: 'job-1' },
        select: { tier: true },
      })
    })

    it('returns zeros for a job position with no CVs', async () => {
      prisma.cV.findMany.mockResolvedValue([])
      const summary = await service.summarizeTiers('empty')
      expect(summary).toEqual({ great: 0, good: 0, noMatch: 0, total: 0 })
    })
  })

  describe('applyAiScores', () => {
    it('passes aiScores through when present', async () => {
      prisma.cV.update.mockResolvedValue(undefined)
      const scores = { scores: [], overallSummary: 'ok' }

      await service.applyAiScores('cv-1', {
        aiScores: scores,
        modelUsed: 'gpt-5-mini',
        costUsd: 0.01,
        finalScore: 72,
        tier: 'good',
      })

      expect(prisma.cV.update).toHaveBeenCalledWith({
        where: { id: 'cv-1' },
        data: expect.objectContaining({
          aiScores: scores,
          aiModelUsed: 'gpt-5-mini',
          aiCostUsd: 0.01,
          finalScore: 72,
          tier: 'good',
        }),
      })
    })

    it('leaves previous aiScores untouched when the AI call produced nothing', async () => {
      prisma.cV.update.mockResolvedValue(undefined)

      await service.applyAiScores('cv-1', {
        aiScores: null,
        modelUsed: 'gpt-5-mini',
        costUsd: 0,
        finalScore: 50,
        tier: 'no-match',
      })

      // `null` inputs become `undefined` in the update payload so Prisma
      // treats the column as "don't touch" rather than overwriting.
      const call = prisma.cV.update.mock.calls[0][0] as {
        data: { aiScores?: unknown }
      }
      expect(call.data.aiScores).toBeUndefined()
    })
  })
})
