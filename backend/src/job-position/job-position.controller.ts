import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Sse,
  MessageEvent,
  BadRequestException,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { Observable, map } from 'rxjs'

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthPayload } from '../auth/auth.service'
import { JobPositionService, UploadedFile } from './job-position.service'
import { OverrideTierDto } from './dto/override-tier.dto'
import { GenerateCVsDto } from '../cv-generator/dto/generate-cvs.dto'

// Multer guardrails — without limits a 300MB PDF would buffer into RAM and stall parsing.
const MAX_UPLOAD_FILES = 500
const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024

@Controller('job-positions/:jobPositionId')
@UseGuards(JwtAuthGuard)
export class JobPositionController {
  constructor(private readonly jobPositionService: JobPositionService) {}

  @Post('cvs')
  @UseInterceptors(
    FilesInterceptor('files', MAX_UPLOAD_FILES, {
      limits: {
        fileSize: MAX_UPLOAD_FILE_BYTES,
        files: MAX_UPLOAD_FILES,
      },
    }),
  )
  async uploadCvs(
    @CurrentUser() user: AuthPayload,
    @Param('jobPositionId') jobPositionId: string,
    @UploadedFiles() files: Array<UploadedFile>,
  ): Promise<{ queued: number }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded')
    }

    return this.jobPositionService.processCVs(user.sub, jobPositionId, files)
  }

  @Get('progress')
  getProgress(
    @CurrentUser() user: AuthPayload,
    @Param('jobPositionId') jobPositionId: string,
  ): Promise<{
    status: string
    currentStage: string | null
    processedCvs: number
    totalCvs: number
  }> {
    return this.jobPositionService.getProgressSnapshot(user.sub, jobPositionId)
  }

  @Sse('progress/stream')
  progressStream(
    @CurrentUser() user: AuthPayload,
    @Param('jobPositionId') jobPositionId: string,
  ): Observable<MessageEvent> {
    return this.jobPositionService
      .subscribeToProgress(user.sub, jobPositionId)
      .pipe(map((event) => ({ data: event })))
  }

  @Get('results')
  getResults(
    @CurrentUser() user: AuthPayload,
    @Param('jobPositionId') jobPositionId: string,
  ) {
    return this.jobPositionService.getResults(user.sub, jobPositionId)
  }

  @Put('cvs/:cvId/override-tier')
  overrideTier(
    @CurrentUser() user: AuthPayload,
    @Param('jobPositionId') jobPositionId: string,
    @Param('cvId') cvId: string,
    @Body() dto: OverrideTierDto,
  ) {
    return this.jobPositionService.overrideTier(
      user.sub,
      jobPositionId,
      cvId,
      dto.tier,
    )
  }

  @Post('rescore')
  rescore(
    @CurrentUser() user: AuthPayload,
    @Param('jobPositionId') jobPositionId: string,
  ): Promise<{ queued: number }> {
    return this.jobPositionService.rescoreExistingCvs(user.sub, jobPositionId)
  }

  @Post('generate-cvs')
  generateCvs(
    @CurrentUser() user: AuthPayload,
    @Param('jobPositionId') jobPositionId: string,
    @Body() dto: GenerateCVsDto,
  ): Promise<{ queued: number }> {
    return this.jobPositionService.generateAndIngest(
      user.sub,
      jobPositionId,
      dto,
    )
  }
}
