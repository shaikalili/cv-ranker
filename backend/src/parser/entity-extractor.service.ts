import { Injectable } from '@nestjs/common'
import { ExtractedEntities, ParsedSections } from '../common/types'

@Injectable()
export class EntityExtractorService {
  private static readonly KNOWN_TECHNOLOGIES = [
    'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c++', 'c#',
    'ruby', 'php', 'kotlin', 'swift',
    'react', 'vue', 'angular', 'svelte', 'next.js', 'nuxt',
    'node.js', 'nodejs', 'express', 'nestjs', 'django', 'flask', 'spring',
    'rails', 'fastapi',
    'kubernetes', 'k8s', 'docker', 'terraform', 'ansible', 'jenkins',
    'gitlab ci', 'github actions', 'circleci',
    'aws', 'gcp', 'azure', 'amazon web services', 'google cloud',
    'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch',
    'dynamodb', 'cassandra',
    'graphql', 'rest', 'grpc', 'kafka', 'rabbitmq',
  ]

  private static readonly DEGREE_PATTERNS = [
    /\b(b\.?sc\.?|bachelor(?:'s)?|bs)\b.*?(?:computer\s+science|cs|engineering|mathematics|physics|[a-z]+)/i,
    /\b(m\.?sc\.?|master(?:'s)?|ms)\b.*?(?:computer\s+science|cs|engineering|mathematics|[a-z]+)/i,
    /\b(ph\.?d\.?|doctorate)\b.*?(?:computer\s+science|cs|engineering|[a-z]+)/i,
  ]

  extract(rawText: string, sections: ParsedSections): ExtractedEntities {
    const lowercaseText = rawText.toLowerCase()

    return {
      yearsOfExperience: this.extractYearsOfExperience(rawText),
      technologies: this.extractTechnologies(lowercaseText),
      degrees: this.extractDegrees(rawText),
      companies: this.extractCompanies(sections.experience),
      roles: this.extractRoles(sections.experience),
    }
  }

  private extractYearsOfExperience(text: string): number {
    const patterns = [
      /(\d+)\+?\s*years?\s+(?:of\s+)?experience/i,
      /experience:?\s*(\d+)\+?\s*years?/i,
      /(\d+)\+?\s*years?\s+in/i,
    ]

    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) {
        const years = parseInt(match[1], 10)
        if (years > 0 && years < 60) return years
      }
    }

    return 0
  }

  private extractTechnologies(lowercaseText: string): string[] {
    const found = new Set<string>()

    for (const tech of EntityExtractorService.KNOWN_TECHNOLOGIES) {
      const regex = new RegExp(`\\b${this.escapeRegex(tech)}\\b`, 'i')
      if (regex.test(lowercaseText)) {
        found.add(tech)
      }
    }

    return Array.from(found)
  }

  private extractDegrees(text: string): string[] {
    const degrees: string[] = []

    for (const pattern of EntityExtractorService.DEGREE_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        degrees.push(match[0].trim())
      }
    }

    return degrees
  }

  // Heuristic capitalized-name match; a production system would use NER.
  private extractCompanies(experienceSection: string): string[] {
    const pattern = /(?:^|\n)\s*([A-Z][A-Za-z0-9&.\s]{2,40}?)(?:\s+[-–|]|\s+\d{4}|\n)/gm
    const companies: string[] = []
    const matches = experienceSection.matchAll(pattern)

    for (const match of matches) {
      const name = match[1].trim()
      if (name.length > 2 && !companies.includes(name)) {
        companies.push(name)
      }
    }

    return companies.slice(0, 10)
  }

  private extractRoles(experienceSection: string): string[] {
    const rolePattern =
      /\b(senior|lead|staff|principal|junior|mid)?\s*(?:software|backend|frontend|fullstack|full-stack|devops|platform|data|ml|ai)?\s*(engineer|developer|architect|manager|director|lead)\b/gi

    const roles = new Set<string>()
    const matches = experienceSection.matchAll(rolePattern)

    for (const match of matches) {
      roles.add(match[0].toLowerCase().trim())
    }

    return Array.from(roles).slice(0, 5)
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
