export interface GeneratedCvExperienceEntry {
  company: string
  role: string
  startYear: number
  endYear: number
  bullets: string[]
}

export interface GeneratedCvContent {
  name: string
  email: string
  yearsExperience: number
  summary: string
  experience: GeneratedCvExperienceEntry[]
  skills: string[]
  education: string
}
