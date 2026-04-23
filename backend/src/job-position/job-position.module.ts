import { Module } from '@nestjs/common'

import { JobPositionController } from './job-position.controller'
import { JobPositionService } from './job-position.service'
import { AuthModule } from '../auth/auth.module'
import { ParserModule } from '../parser/parser.module'
import { AnonymizationModule } from '../anonymization/anonymization.module'
import { FilterModule } from '../filter/filter.module'
import { AiModule } from '../ai/ai.module'
import { ScoringModule } from '../scoring/scoring.module'
import { JobDescriptionModule } from '../job-description/job-description.module'
import { CvGeneratorModule } from '../cv-generator/cv-generator.module'
import { ResumeModule } from '../resume/resume.module'

@Module({
  imports: [
    AuthModule,
    ParserModule,
    AnonymizationModule,
    FilterModule,
    AiModule,
    ScoringModule,
    JobDescriptionModule,
    CvGeneratorModule,
    ResumeModule,
  ],
  controllers: [JobPositionController],
  providers: [JobPositionService],
  exports: [JobPositionService],
})
export class JobPositionModule {}
