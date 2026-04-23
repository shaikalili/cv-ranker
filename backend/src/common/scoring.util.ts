import { CVTier, Requirement } from './types'

// Filter + AI stages use the same math but different thresholds (see each service).
export interface TierThresholds {
  great: number
  good: number
  maxMissingRequired: number
}

export function weightedScore(
  requirements: Requirement[],
  scoreFor: (requirementId: string) => number,
): number {
  let weightedSum = 0
  let maxWeight = 0

  for (const req of requirements) {
    weightedSum += scoreFor(req.id) * req.weight
    maxWeight += req.weight
  }

  if (maxWeight === 0) return 0
  return (weightedSum / maxWeight) * 100
}

// "Unmet" is stage-specific: callers pass a predicate (filter: 0, AI: <0.5).
export function countMissingRequired(
  requirements: Requirement[],
  scoreFor: (requirementId: string) => number,
  isMissing: (score: number) => boolean,
): number {
  let count = 0
  for (const req of requirements) {
    if (req.isRequired && isMissing(scoreFor(req.id))) count++
  }
  return count
}

// `great` requires zero missing required — a high aggregate score can't overpower a hard requirement gap.
export function assignTier(
  score: number,
  missingRequired: number,
  thresholds: TierThresholds,
): CVTier {
  if (missingRequired >= thresholds.maxMissingRequired) return 'no-match'
  if (missingRequired === 0 && score >= thresholds.great) return 'great'
  if (score >= thresholds.good) return 'good'
  return 'no-match'
}
