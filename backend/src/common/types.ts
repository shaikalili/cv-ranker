export type RequirementType =
  | 'technology'
  | 'experience'
  | 'education'
  | 'softSkill'

export interface Requirement {
  id: string
  text: string
  type: RequirementType
  weight: number
  isRequired: boolean
  keywords: string[]
  synonyms: string[]
}

export interface ParsedSections {
  experience: string
  skills: string
  education: string
  summary: string
  other: string
}

export interface ExtractedEntities {
  yearsOfExperience: number
  technologies: string[]
  degrees: string[]
  companies: string[]
  roles: string[]
}

export type ParsingConfidence = 'high' | 'medium' | 'low' | 'failed'

export interface ParsedCV {
  rawText: string
  sections: ParsedSections
  sentences: string[]
  entities: ExtractedEntities
  parsingConfidence: ParsingConfidence
  parseError?: string
}

export interface KeywordMatchData {
  matchedSentences: string[]
  rawScore: number
}

export type KeywordScores = Record<string, KeywordMatchData>

export interface RequirementAIScore {
  requirementId: string
  score: number
  reasoning: string
  evidence: string
}

export interface AIScoreResponse {
  scores: RequirementAIScore[]
  overallSummary: string
}

export type CVTier = 'great' | 'good' | 'no-match'
