export interface User {
  id: string
  email: string
  name: string
}

export interface AuthResponse {
  accessToken: string
  user: User
}

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

export type JobPositionStatus =
  | 'CREATED'
  | 'EXTRACTING_REQUIREMENTS'
  | 'REQUIREMENTS_EXTRACTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'

export type PipelineStage =
  | 'parsing'
  | 'filtering'
  | 'scoring'
  | 'completed'
  | 'failed'

export interface JobPosition {
  id: string
  title: string
  jobDescriptionText: string
  requirements: Requirement[]
  status: JobPositionStatus
  totalCvs: number
  processedCvs: number
  greatMatchCount: number
  goodMatchCount: number
  noMatchCount: number
  aiCostUsd: number
  currentStage: PipelineStage | null
  createdAt: string
}

export interface ProgressSnapshot {
  status: JobPositionStatus
  currentStage: PipelineStage | null
  processedCvs: number
  totalCvs: number
}

export type CVTier = 'great' | 'good' | 'no-match'

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

export interface KeywordMatchData {
  matchedSentences: string[]
  rawScore: number
}

export interface ParsedSections {
  experience: string
  skills: string
  education: string
  summary: string
  other: string
}

export interface CV {
  id: string
  jobPositionId: string
  originalFilename: string
  parsingConfidence: 'high' | 'medium' | 'low' | 'failed'
  keywordScores: Record<string, KeywordMatchData>
  aiScores: AIScoreResponse | null
  finalScore: number | null
  tier: CVTier | null
  eliminationReason: string | null
  aiModelUsed: string | null
  aiCostUsd: number
  rawText: string
  sections: ParsedSections
  sentences: string[]
  entities: {
    yearsOfExperience: number
    technologies: string[]
    degrees: string[]
    companies: string[]
    roles: string[]
  }
}

export interface RankedResults {
  great: CV[]
  good: CV[]
  noMatch: CV[]
}

export interface ResultsResponse {
  jobPosition: JobPosition
  ranked: RankedResults
}

export interface ProgressEvent {
  stage: PipelineStage | 'heartbeat'
  processed: number
  total: number
}
