import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { CvGeneratorService } from './cv-generator.service'

@Module({
  imports: [AiModule],
  providers: [CvGeneratorService],
  exports: [CvGeneratorService],
})
export class CvGeneratorModule {}
