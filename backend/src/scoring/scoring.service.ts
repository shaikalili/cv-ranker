import { Injectable } from '@nestjs/common'

import {
  AIScoreResponse,
  CVTier,
  KeywordScores,
  Requirement,
} from '../common/types'
import {
  TierThresholds,
  assignTier,
  countMissingRequired,
  weightedScore,
} from '../common/scoring.util'

export interface ScoringResult {
  finalScore: number
  tier: CVTier
  missingRequiredCount: number
}

@Injectable()
export class ScoringService {
  // Precision stage — stricter thresholds than FilterService because AI scores
  // are fine-grained. Required-weight multiplier in `weightedScore` already
  // penalises missed must-haves proportionally, so no flat penalty is applied.
  private static readonly TIER_THRESHOLDS: TierThresholds = {
    great: 85,
    good: 60,
    missingRequiredRatio: 0.5,
  }

  private static readonly AI_MISSING_THRESHOLD = 0.5

  computeFinalScore(
    requirements: Requirement[],
    keywordScores: KeywordScores,
    aiScores: AIScoreResponse | null,
  ): ScoringResult {
    const scoreFor = (reqId: string) =>
      this.getBestScore(reqId, keywordScores, aiScores)

    const missingRequiredCount = countMissingRequired(
      requirements,
      scoreFor,
      (score) => score < ScoringService.AI_MISSING_THRESHOLD,
    )
    const totalRequired = requirements.filter((r) => r.isRequired).length

    const baseScore = weightedScore(requirements, scoreFor)
    const finalScore = Math.max(0, Math.round(baseScore))

    const tier = assignTier(
      finalScore,
      missingRequiredCount,
      totalRequired,
      ScoringService.TIER_THRESHOLDS,
    )

    return { finalScore, tier, missingRequiredCount }
  }

  private getBestScore(
    requirementId: string,
    keywordScores: KeywordScores,
    aiScores: AIScoreResponse | null,
  ): number {
    if (aiScores) {
      const aiScore = aiScores.scores.find(
        (s) => s.requirementId === requirementId,
      )
      if (aiScore) return aiScore.score
    }
    return keywordScores[requirementId]?.rawScore ?? 0
  }
}
