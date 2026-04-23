import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { JobPosition } from '@prisma/client'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'

import { PrismaService } from '../common/prisma/prisma.service'
import { AiService } from '../ai/ai.service'
import { Requirement } from '../common/types'
import { jobLogger, startOp } from '../common/logging'
import { CreateJobPositionDto } from './dto/create-job-position.dto'
import { UpdateRequirementsDto } from './dto/update-requirements.dto'

export interface JobPositionSummary {
  great: number
  good: number
  noMatch: number
  total: number
}

export type PipelineStage =
  | 'generating'
  | 'parsing'
  | 'filtering'
  | 'scoring'
  | 'completed'
  | 'failed'

const STALE_PROCESSING_MINUTES = 15

@Injectable()
export class JobDescriptionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    @InjectPinoLogger(JobDescriptionService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Startup sweeper: flip rows orphaned by a crash/deploy to FAILED so the UI never shows a perpetual spinner.
  async onModuleInit(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000)
    const processingResult = await this.prisma.jobPosition.updateMany({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
      data: { status: 'FAILED', currentStage: 'failed' },
    })
    const extractingResult = await this.prisma.jobPosition.updateMany({
      where: {
        status: 'EXTRACTING_REQUIREMENTS',
        updatedAt: { lt: cutoff },
      },
      data: { status: 'FAILED' },
    })
    const total = processingResult.count + extractingResult.count
    if (total > 0) {
      this.logger.warn(
        {
          event: 'job.startup_sweeper.marked_failed',
          processing: processingResult.count,
          extracting: extractingResult.count,
          staleMinutes: STALE_PROCESSING_MINUTES,
        },
        `startup sweeper marked ${total} stale row(s) as FAILED`,
      )
    }
  }

  async createJobPosition(
    userId: string,
    dto: CreateJobPositionDto,
  ): Promise<JobPosition> {
    const jobPosition = await this.prisma.jobPosition.create({
      data: {
        userId,
        title: dto.title,
        jobDescriptionText: dto.jobDescriptionText,
        requirements: [],
        status: 'CREATED',
      },
    })

    this.logger.info(
      {
        event: 'job.create.ok',
        jobPositionId: jobPosition.id,
        userId,
        title: dto.title,
      },
      'created job position (extraction pending)',
    )
    return jobPosition
  }

  // Idempotent: retry-safe on CREATED/FAILED, no-op on downstream states so we never clobber user edits.
  async extractRequirements(
    userId: string,
    jobPositionId: string,
  ): Promise<JobPosition> {
    const log = jobLogger(this.logger, jobPositionId, userId)
    const jobPosition = await this.findById(userId, jobPositionId)

    if (
      jobPosition.status !== 'CREATED' &&
      jobPosition.status !== 'FAILED'
    ) {
      log.info(
        { event: 'job.extract_requirements.skipped', status: jobPosition.status },
        'extractRequirements skipped',
      )
      return jobPosition
    }

    const op = startOp(log, 'job.extract_requirements')
    await this.prisma.jobPosition.update({
      where: { id: jobPositionId },
      data: { status: 'EXTRACTING_REQUIREMENTS' },
    })

    try {
      const { requirements, costUsd } =
        await this.aiService.extractRequirements(jobPosition.jobDescriptionText)

      const updated = await this.prisma.jobPosition.update({
        where: { id: jobPositionId },
        data: {
          requirements: requirements as unknown as object,
          status: 'REQUIREMENTS_EXTRACTED',
          aiCostUsd: costUsd,
        },
      })

      op.ok({ n: requirements.length, costUsd })
      return updated
    } catch (err) {
      await this.prisma.jobPosition.update({
        where: { id: jobPositionId },
        data: { status: 'FAILED' },
      })
      op.fail(err)
      throw err
    }
  }

  async updateRequirements(
    userId: string,
    jobPositionId: string,
    dto: UpdateRequirementsDto,
  ): Promise<JobPosition> {
    await this.assertOwnership(userId, jobPositionId)

    const updated = await this.prisma.jobPosition.update({
      where: { id: jobPositionId },
      data: {
        requirements: dto.requirements as unknown as object,
      },
    })

    this.logger.info(
      {
        event: 'job.update_requirements.ok',
        jobPositionId,
        userId,
        n: dto.requirements.length,
      },
      'updated requirements',
    )
    return updated
  }

  async findById(
    userId: string,
    jobPositionId: string,
  ): Promise<JobPosition> {
    const jobPosition = await this.prisma.jobPosition.findUnique({
      where: { id: jobPositionId },
    })

    if (!jobPosition) {
      throw new NotFoundException('Job position not found')
    }

    if (jobPosition.userId !== userId) {
      throw new ForbiddenException('Job position does not belong to this user')
    }

    return jobPosition
  }

  async listByUser(userId: string): Promise<JobPosition[]> {
    return this.prisma.jobPosition.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async delete(userId: string, jobPositionId: string): Promise<void> {
    await this.assertOwnership(userId, jobPositionId)
    await this.prisma.jobPosition.delete({ where: { id: jobPositionId } })
    this.logger.info(
      { event: 'job.delete.ok', jobPositionId, userId },
      'deleted job position',
    )
  }

  async getRequirements(
    userId: string,
    jobPositionId: string,
  ): Promise<Requirement[]> {
    const jobPosition = await this.findById(userId, jobPositionId)
    return jobPosition.requirements as unknown as Requirement[]
  }
  
  async startProcessing(
    jobPositionId: string,
    opts: { addCvs?: number; initialStage?: PipelineStage } = {},
  ): Promise<void> {
    await this.prisma.jobPosition.update({
      where: { id: jobPositionId },
      data: {
        status: 'PROCESSING',
        processedCvs: 0,
        currentStage: opts.initialStage ?? 'parsing',
        ...(opts.addCvs !== undefined
          ? { totalCvs: { increment: opts.addCvs } }
          : {}),
      },
    })
  }

  async updateStage(
    jobPositionId: string,
    stage: PipelineStage,
  ): Promise<void> {
    await this.prisma.jobPosition.update({
      where: { id: jobPositionId },
      data: { currentStage: stage },
    })
  }

  // Called after manual HR tier overrides to keep the denormalized counts in sync.
  async refreshTierCounts(
    jobPositionId: string,
    summary: JobPositionSummary,
  ): Promise<void> {
    await this.prisma.jobPosition.update({
      where: { id: jobPositionId },
      data: {
        totalCvs: summary.total,
        processedCvs: summary.total,
        greatMatchCount: summary.great,
        goodMatchCount: summary.good,
        noMatchCount: summary.noMatch,
      },
    })
  }

  async completeProcessing(
    jobPositionId: string,
    input: { summary: JobPositionSummary; aiCostDelta: number },
  ): Promise<void> {
    await this.prisma.jobPosition.update({
      where: { id: jobPositionId },
      data: {
        status: 'COMPLETED',
        currentStage: 'completed',
        processedCvs: input.summary.total,
        greatMatchCount: input.summary.great,
        goodMatchCount: input.summary.good,
        noMatchCount: input.summary.noMatch,
        aiCostUsd: { increment: input.aiCostDelta },
      },
    })
  }

  async markFailed(jobPositionId: string): Promise<void> {
    await this.prisma.jobPosition.update({
      where: { id: jobPositionId },
      data: { status: 'FAILED', currentStage: 'failed' },
    })
  }

  private async assertOwnership(
    userId: string,
    jobPositionId: string,
  ): Promise<void> {
    await this.findById(userId, jobPositionId)
  }
}
