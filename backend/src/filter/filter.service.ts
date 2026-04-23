import { Injectable } from '@nestjs/common'

import {
  CVTier,
  KeywordScores,
  ParsedCV,
  Requirement,
} from '../common/types'
import {
  TierThresholds,
  assignTier,
  countMissingRequired,
  weightedScore,
} from '../common/scoring.util'

export interface FilterResult {
  keywordScores: KeywordScores
  preliminaryScore: number
  missingRequiredCount: number
  preliminaryTier: CVTier
  eliminationReason?: string
}

// Stage 1 keyword filter. Optimizes for recall so the AI stage is the precision gate.
@Injectable()
export class FilterService {
  private static readonly MULTI_MATCH_THRESHOLD = 3

  // Keyword stage is intentionally lenient — the AI stage is the precision gate.
  private static readonly TIER_THRESHOLDS: TierThresholds = {
    great: 70,
    good: 40,
    missingRequiredRatio: 0.6,
  }

  filter(cv: ParsedCV, requirements: Requirement[]): FilterResult {
    const keywordScores: KeywordScores = {}

    for (const req of requirements) {
      const matches = this.findMatchingSentences(cv.sentences, req)
      keywordScores[req.id] = {
        matchedSentences: matches,
        rawScore: this.scoreMatches(matches.length),
      }
    }

    const scoreFor = (reqId: string) => keywordScores[reqId]?.rawScore ?? 0

    const missingRequiredCount = countMissingRequired(
      requirements,
      scoreFor,
      (score) => score === 0,
    )
    const totalRequired = requirements.filter((r) => r.isRequired).length

    const preliminaryScore = weightedScore(requirements, scoreFor)
    const tier = assignTier(
      preliminaryScore,
      missingRequiredCount,
      totalRequired,
      FilterService.TIER_THRESHOLDS,
    )

    return {
      keywordScores,
      preliminaryScore,
      missingRequiredCount,
      preliminaryTier: tier,
      eliminationReason:
        tier === 'no-match'
          ? this.buildEliminationReason(
              missingRequiredCount,
              totalRequired,
              preliminaryScore,
            )
          : undefined,
    }
  }

  private findMatchingSentences(
    sentences: string[],
    requirement: Requirement,
  ): string[] {
    const needles = [...requirement.keywords, ...requirement.synonyms]
      .map((s) => normalize(s))
      .filter((s) => s.length > 0)

    if (needles.length === 0) return []

    return sentences.filter((sentence) => {
      const haystack = normalize(sentence)
      return needles.some((needle) => matchesWithBoundary(haystack, needle))
    })
  }

  private scoreMatches(matchCount: number): number {
    if (matchCount === 0) return 0
    if (matchCount >= FilterService.MULTI_MATCH_THRESHOLD) return 1.0
    return 0.6
  }

  private buildEliminationReason(
    missingRequired: number,
    totalRequired: number,
    score: number,
  ): string {
    if (totalRequired > 0) {
      const limit = Math.ceil(
        totalRequired * FilterService.TIER_THRESHOLDS.missingRequiredRatio,
      )
      if (missingRequired >= limit) {
        return `Missing ${missingRequired} of ${totalRequired} required requirements`
      }
    }
    return `Score too low (${score.toFixed(1)}/100)`
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Hand-rolled boundary match — avoids regex so user-supplied needles like "c++" / ".net" don't need escaping.
function matchesWithBoundary(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false

  let fromIndex = 0
  while (fromIndex <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, fromIndex)
    if (idx === -1) return false

    const before = idx === 0 ? ' ' : haystack[idx - 1]
    const afterPos = idx + needle.length
    const after = afterPos === haystack.length ? ' ' : haystack[afterPos]

    if (!isWordChar(before) && !isWordChar(after)) return true
    fromIndex = idx + 1
  }
  return false
}

function isWordChar(ch: string): boolean {
  return /[a-z0-9]/.test(ch)
}
