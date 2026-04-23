import { Module } from '@nestjs/common'
import { ScoringService } from './scoring.service'
import { RankingService } from './ranking.service'

@Module({
  providers: [ScoringService, RankingService],
  exports: [ScoringService, RankingService],
})
export class ScoringModule {}
