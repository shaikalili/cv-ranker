import { ScoringService } from '../../../src/scoring/scoring.service'
import {
  Requirement,
  KeywordScores,
  AIScoreResponse,
} from '../../../src/common/types'

describe('ScoringService', () => {
  let service: ScoringService

  const reqs: Requirement[] = [
    {
      id: 'r1',
      text: 'Node.js',
      type: 'technology',
      weight: 9,
      isRequired: true,
      keywords: ['node'],
      synonyms: [],
    },
    {
      id: 'r2',
      text: 'K8s',
      type: 'technology',
      weight: 9,
      isRequired: true,
      keywords: ['k8s'],
      synonyms: [],
    },
    {
      id: 'r3',
      text: 'AWS',
      type: 'technology',
      weight: 5,
      isRequired: false,
      keywords: ['aws'],
      synonyms: [],
    },
  ]

  beforeEach(() => {
    service = new ScoringService()
  })

  it('returns great tier when all requirements strongly met', () => {
    const keywordScores: KeywordScores = {
      r1: { matchedSentences: [], rawScore: 1.0 },
      r2: { matchedSentences: [], rawScore: 1.0 },
      r3: { matchedSentences: [], rawScore: 1.0 },
    }
    const aiScores: AIScoreResponse = {
      scores: [
        { requirementId: 'r1', score: 1.0, reasoning: '', evidence: '' },
        { requirementId: 'r2', score: 1.0, reasoning: '', evidence: '' },
        { requirementId: 'r3', score: 1.0, reasoning: '', evidence: '' },
      ],
      overallSummary: '',
    }
    const result = service.computeFinalScore(reqs, keywordScores, aiScores)
    expect(result.tier).toBe('great')
    expect(result.finalScore).toBe(100)
    expect(result.missingRequiredCount).toBe(0)
  })

  it('tracks missing required requirements in the result', () => {
    const keywordScores: KeywordScores = {
      r1: { matchedSentences: [], rawScore: 1.0 },
      r2: { matchedSentences: [], rawScore: 0 },
      r3: { matchedSentences: [], rawScore: 1.0 },
    }
    // r2 missing (1 of 2 required). Ratio 0.5 → ceil(2 * 0.5) = 1
    // → elimination triggers. Required-weight multiplier already drags
    // the score well below the 'good' line, so the result is no-match.
    const result = service.computeFinalScore(reqs, keywordScores, null)
    expect(result.missingRequiredCount).toBe(1)
    expect(result.tier).toBe('no-match')
  })

  it('returns no-match when 2+ required missing', () => {
    const keywordScores: KeywordScores = {
      r1: { matchedSentences: [], rawScore: 0 },
      r2: { matchedSentences: [], rawScore: 0 },
      r3: { matchedSentences: [], rawScore: 1.0 },
    }
    const result = service.computeFinalScore(reqs, keywordScores, null)
    expect(result.tier).toBe('no-match')
  })

  it('prefers AI score when available', () => {
    const keywordScores: KeywordScores = {
      r1: { matchedSentences: [], rawScore: 0.6 },
      r2: { matchedSentences: [], rawScore: 0.6 },
      r3: { matchedSentences: [], rawScore: 0 },
    }
    const aiScores: AIScoreResponse = {
      scores: [
        { requirementId: 'r1', score: 1.0, reasoning: '', evidence: '' },
        { requirementId: 'r2', score: 1.0, reasoning: '', evidence: '' },
        { requirementId: 'r3', score: 0.3, reasoning: '', evidence: '' },
      ],
      overallSummary: '',
    }
    const withoutAi = service.computeFinalScore(reqs, keywordScores, null)
    const withAi = service.computeFinalScore(reqs, keywordScores, aiScores)
    expect(withAi.finalScore).toBeGreaterThan(withoutAi.finalScore)
  })

  describe('tier thresholds', () => {
    it('lands "good" when score clears 60 but not 85', () => {
      // r1: 0.7, r2: 0.7, r3: 0.8 → weighted roughly (9*0.7 + 9*0.7 + 5*0.8) / 23
      //   ≈ 0.7217 → score 72 → good (between 60 and 85), no penalty.
      const aiScores: AIScoreResponse = {
        scores: [
          { requirementId: 'r1', score: 0.7, reasoning: '', evidence: '' },
          { requirementId: 'r2', score: 0.7, reasoning: '', evidence: '' },
          { requirementId: 'r3', score: 0.8, reasoning: '', evidence: '' },
        ],
        overallSummary: '',
      }
      const result = service.computeFinalScore(reqs, {}, aiScores)
      expect(result.tier).toBe('good')
      expect(result.finalScore).toBeGreaterThanOrEqual(60)
      expect(result.finalScore).toBeLessThan(85)
    })

    it('lands "no-match" when weighted score is below 60', () => {
      const aiScores: AIScoreResponse = {
        scores: [
          { requirementId: 'r1', score: 0.55, reasoning: '', evidence: '' },
          { requirementId: 'r2', score: 0.55, reasoning: '', evidence: '' },
          { requirementId: 'r3', score: 0.55, reasoning: '', evidence: '' },
        ],
        overallSummary: '',
      }
      const result = service.computeFinalScore(reqs, {}, aiScores)
      expect(result.tier).toBe('no-match')
    })

    it('clamps final score to 0 on worst-case input (AI says 0 across the board)', () => {
      const aiScores: AIScoreResponse = {
        scores: [
          { requirementId: 'r1', score: 0, reasoning: '', evidence: '' },
          { requirementId: 'r2', score: 0, reasoning: '', evidence: '' },
          { requirementId: 'r3', score: 0, reasoning: '', evidence: '' },
        ],
        overallSummary: '',
      }
      const result = service.computeFinalScore(reqs, {}, aiScores)
      // Weighted numerator is 0 so the final score lands at 0; no flat penalty
      // is subtracted now that the required-weight multiplier carries the load.
      expect(result.finalScore).toBe(0)
      expect(result.tier).toBe('no-match')
    })

    it('eliminates when half or more of the required items are missing (ratio 0.5)', () => {
      // 2 required items (r1, r2). Missing 1 of 2 = 50%, which is NOT "more
      // than 50% met" per the product rule, so the candidate is eliminated.
      const aiScores: AIScoreResponse = {
        scores: [
          { requirementId: 'r1', score: 1.0, reasoning: '', evidence: '' },
          { requirementId: 'r2', score: 0.0, reasoning: '', evidence: '' },
          { requirementId: 'r3', score: 1.0, reasoning: '', evidence: '' },
        ],
        overallSummary: '',
      }
      const result = service.computeFinalScore(reqs, {}, aiScores)
      expect(result.missingRequiredCount).toBe(1)
      expect(result.tier).toBe('no-match')
    })

    it('required-weight multiplier makes must-haves dominate the numeric score', () => {
      // All requireds met at 1.0, nice-to-have missed entirely. Under the old
      // formula (no multiplier) the nice-to-have at weight 5 would drag the
      // score. Under the new formula it's dwarfed by the 2× required weights.
      const aiScores: AIScoreResponse = {
        scores: [
          { requirementId: 'r1', score: 1.0, reasoning: '', evidence: '' },
          { requirementId: 'r2', score: 1.0, reasoning: '', evidence: '' },
          { requirementId: 'r3', score: 0.0, reasoning: '', evidence: '' },
        ],
        overallSummary: '',
      }
      const result = service.computeFinalScore(reqs, {}, aiScores)
      // weighted: (9*2*1 + 9*2*1 + 5*0) / (9*2 + 9*2 + 5) = 36 / 41 ≈ 87.8
      expect(result.finalScore).toBeGreaterThanOrEqual(85)
      expect(result.tier).toBe('great')
    })

    it('falls back to keyword scores for requirements the AI did not score', () => {
      const keywordScores: KeywordScores = {
        r1: { matchedSentences: [], rawScore: 1.0 },
        r2: { matchedSentences: [], rawScore: 1.0 },
        r3: { matchedSentences: [], rawScore: 1.0 },
      }
      // AI only scored r1 — r2 and r3 should fall back to keyword scores.
      const partialAi: AIScoreResponse = {
        scores: [
          { requirementId: 'r1', score: 1.0, reasoning: '', evidence: '' },
        ],
        overallSummary: '',
      }
      const result = service.computeFinalScore(reqs, keywordScores, partialAi)
      expect(result.missingRequiredCount).toBe(0)
      expect(result.tier).toBe('great')
    })
  })
})
