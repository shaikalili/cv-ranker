import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { JobPosition } from '@prisma/client'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthPayload } from '../auth/auth.service'
import { JobDescriptionService } from './job-description.service'
import { CreateJobPositionDto } from './dto/create-job-position.dto'
import { UpdateRequirementsDto } from './dto/update-requirements.dto'

@Controller('job-positions')
@UseGuards(JwtAuthGuard)
export class JobDescriptionController {
  constructor(
    private readonly service: JobDescriptionService,
    @InjectPinoLogger(JobDescriptionController.name)
    private readonly logger: PinoLogger,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthPayload,
    @Body() dto: CreateJobPositionDto,
  ): Promise<JobPosition> {
    return this.service.createJobPosition(user.sub, dto)
  }

  // Fire-and-forget retry entrypoint. 202 so the client can redirect immediately; status transitions via polling.
  @Post(':id/extract-requirements')
  @HttpCode(HttpStatus.ACCEPTED)
  async extractRequirements(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
  ): Promise<{ queued: true }> {
    // Ownership check runs sync so 403/404 returns now; AI call runs in background.
    await this.service.findById(user.sub, id)

    void this.service.extractRequirements(user.sub, id).catch((err) => {
      this.logger.error(
        {
          event: 'job.extract_requirements.background_failed',
          err,
          jobPositionId: id,
          userId: user.sub,
        },
        'extractRequirements background failure',
      )
    })

    return { queued: true }
  }

  @Get()
  list(@CurrentUser() user: AuthPayload): Promise<JobPosition[]> {
    return this.service.listByUser(user.sub)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
  ): Promise<JobPosition> {
    return this.service.findById(user.sub, id)
  }

  @Put(':id/requirements')
  updateRequirements(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRequirementsDto,
  ): Promise<JobPosition> {
    return this.service.updateRequirements(user.sub, id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
  ): Promise<void> {
    return this.service.delete(user.sub, id)
  }
}
