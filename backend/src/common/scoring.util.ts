import { CVTier, Requirement } from './types'

// Filter + AI stages use the same math but different thresholds (see each service).
export interface TierThresholds {
  great: number
  good: number
  // Candidate is eliminated when ≥ ceil(totalRequired * missingRequiredRatio)
  // of their required requirements are missing. Scaling with the job's size
  // keeps the bar meaningful for both 3-req and 20-req jobs.
  missingRequiredRatio: number
}

// Required items contribute REQUIRED_WEIGHT_MULTIPLIER × their weight in the
// aggregate score. Combined with the weight bands the extraction prompt enforces
// (required 6-10, nice-to-have 1-6), this guarantees a single must-have
// outweighs the strongest nice-to-have.
export const REQUIRED_WEIGHT_MULTIPLIER = 2.0

export function weightedScore(
  requirements: Requirement[],
  scoreFor: (requirementId: string) => number,
): number {
  let weightedSum = 0
  let maxWeight = 0

  for (const req of requirements) {
    const effectiveWeight = req.isRequired
      ? req.weight * REQUIRED_WEIGHT_MULTIPLIER
      : req.weight
    weightedSum += scoreFor(req.id) * effectiveWeight
    maxWeight += effectiveWeight
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

// `great` still requires zero missing required — a high aggregate score can't
// overpower a hard requirement gap.
export function assignTier(
  score: number,
  missingRequired: number,
  totalRequired: number,
  thresholds: TierThresholds,
): CVTier {
  if (totalRequired > 0) {
    const eliminationLimit = Math.ceil(
      totalRequired * thresholds.missingRequiredRatio,
    )
    if (missingRequired >= eliminationLimit) return 'no-match'
  }
  if (missingRequired === 0 && score >= thresholds.great) return 'great'
  if (score >= thresholds.good) return 'good'
  return 'no-match'
}
