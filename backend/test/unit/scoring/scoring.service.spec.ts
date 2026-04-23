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

  it('penalizes missing required requirements', () => {
    const keywordScores: KeywordScores = {
      r1: { matchedSentences: [], rawScore: 1.0 },
      r2: { matchedSentences: [], rawScore: 0 },
      r3: { matchedSentences: [], rawScore: 1.0 },
    }
    const result = service.computeFinalScore(reqs, keywordScores, null)
    expect(result.missingRequiredCount).toBe(1)
    expect(result.finalScore).toBeLessThan(80)
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
      // baseScore would be 0; penalty of 7 * 2 = 14 would go negative, but
      // the service clamps at 0.
      expect(result.finalScore).toBe(0)
      expect(result.tier).toBe('no-match')
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
