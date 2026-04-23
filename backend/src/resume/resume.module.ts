import { Module } from '@nestjs/common'

import { ResumeController } from './resume.controller'
import { ResumeService } from './resume.service'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule],
  controllers: [ResumeController],
  providers: [ResumeService],
  exports: [ResumeService],
})
export class ResumeModule {}
