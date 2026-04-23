import { Injectable } from '@nestjs/common'
import { CV } from '@prisma/client'

import { CVTier } from '../common/types'

export interface RankedResults {
  great: CV[]
  good: CV[]
  noMatch: CV[]
}

@Injectable()
export class RankingService {
  rank(cvs: CV[]): RankedResults {
    return {
      great: this.sortWithinTier(cvs.filter((cv) => cv.tier === 'great')),
      good: this.sortWithinTier(cvs.filter((cv) => cv.tier === 'good')),
      noMatch: this.sortWithinTier(
        cvs.filter((cv) => cv.tier === 'no-match' || cv.tier === null),
      ),
    }
  }

  private sortWithinTier(cvs: CV[]): CV[] {
    return [...cvs].sort((a, b) => {
      const scoreA = a.finalScore ?? 0
      const scoreB = b.finalScore ?? 0
      return scoreB - scoreA
    })
  }
}
