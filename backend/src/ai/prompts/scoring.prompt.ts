import { ParsedCV, Requirement, KeywordScores } from '../../common/types'

export const SCORING_SYSTEM_PROMPT = `You are an expert technical recruiter.
Score candidates against specific requirements.
Return valid JSON only — no prose, no markdown fences.

SCORING SCALE (use only these values):
  0.0 = requirement not met or not mentioned
  0.3 = mentioned superficially (e.g. a course, brief exposure, "familiar with")
  0.6 = used in real work with limited depth
  1.0 = deep production experience, leadership, or expert level

Rules:
- Be strict. If there is no direct evidence, give 0.0.
- You MUST quote a direct sentence from the CV as evidence when score > 0.
- One sentence of reasoning per requirement, no longer.
- Do not invent facts or infer skills that are not stated.`

export function buildScoringUserPrompt(
  cv: ParsedCV,
  anonymizedText: string,
  requirements: Requirement[],
  keywordScores: KeywordScores,
): string {
  const requirementPayload = requirements.map((r) => ({
    id: r.id,
    text: r.text,
    isRequired: r.isRequired,
    weight: r.weight,
  }))

  const matchedSentencesPayload = Object.entries(keywordScores)
    .map(([reqId, data]) => {
      if (data.matchedSentences.length === 0) return null
      return `${reqId}: ${data.matchedSentences.join(' | ')}`
    })
    .filter(Boolean)
    .join('\n')

  return `REQUIREMENTS TO SCORE:
${JSON.stringify(requirementPayload, null, 2)}

CANDIDATE SNAPSHOT:
Years of experience: ${cv.entities.yearsOfExperience}
Technologies mentioned: ${cv.entities.technologies.join(', ') || '(none detected)'}

RELEVANT SENTENCES PER REQUIREMENT:
${matchedSentencesPayload || '(no keyword matches found)'}

FULL ANONYMIZED CV TEXT:
${anonymizedText}

Return JSON:
{
  "scores": [
    {
      "requirementId": string,
      "score": 0.0 | 0.3 | 0.6 | 1.0,
      "reasoning": string,
      "evidence": string
    }
  ],
  "overallSummary": string
}`
}
