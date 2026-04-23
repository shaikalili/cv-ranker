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
  // Precision stage — stricter than FilterService because AI scores are fine-grained.
  private static readonly TIER_THRESHOLDS: TierThresholds = {
    great: 85,
    good: 60,
    maxMissingRequired: 3,
  }

  private static readonly MISSING_REQUIRED_PENALTY = 7

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

    const baseScore = weightedScore(requirements, scoreFor)
    const penalty =
      missingRequiredCount * ScoringService.MISSING_REQUIRED_PENALTY
    const finalScore = Math.max(0, baseScore - penalty)

    const tier = assignTier(
      finalScore,
      missingRequiredCount,
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
