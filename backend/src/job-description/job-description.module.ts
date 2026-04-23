import { Module } from '@nestjs/common'

import { JobDescriptionController } from './job-description.controller'
import { JobDescriptionService } from './job-description.service'
import { AuthModule } from '../auth/auth.module'
import { AiModule } from '../ai/ai.module'

@Module({
  imports: [AuthModule, AiModule],
  controllers: [JobDescriptionController],
  providers: [JobDescriptionService],
  exports: [JobDescriptionService],
})
export class JobDescriptionModule {}
