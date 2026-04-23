import { EntityExtractorService } from '../../../src/parser/entity-extractor.service'
import { ParsedSections } from '../../../src/common/types'

describe('EntityExtractorService', () => {
  let service: EntityExtractorService

  const emptySections: ParsedSections = {
    experience: '',
    skills: '',
    education: '',
    summary: '',
    other: '',
  }

  beforeEach(() => {
    service = new EntityExtractorService()
  })

  describe('yearsOfExperience', () => {
    it('extracts "5+ years of experience"', () => {
      const result = service.extract(
        'I have 5+ years of experience',
        emptySections,
      )
      expect(result.yearsOfExperience).toBe(5)
    })

    it('extracts "7 years in"', () => {
      const result = service.extract('7 years in backend', emptySections)
      expect(result.yearsOfExperience).toBe(7)
    })

    it('returns 0 when no years mentioned', () => {
      const result = service.extract('I love coding', emptySections)
      expect(result.yearsOfExperience).toBe(0)
    })
  })

  describe('technologies', () => {
    it('finds multiple technologies', () => {
      const result = service.extract(
        'Built apps with Node.js, React, and Kubernetes',
        emptySections,
      )
      expect(result.technologies).toContain('node.js')
      expect(result.technologies).toContain('react')
      expect(result.technologies).toContain('kubernetes')
    })

    it('ignores technologies not mentioned', () => {
      const result = service.extract(
        'Only worked with Python',
        emptySections,
      )
      expect(result.technologies).not.toContain('kubernetes')
    })

    it('is case-insensitive', () => {
      const result = service.extract('KUBERNETES pro', emptySections)
      expect(result.technologies).toContain('kubernetes')
    })
  })

  describe('degrees', () => {
    it('extracts bachelor degree', () => {
      const result = service.extract(
        'B.Sc Computer Science from Tel Aviv',
        emptySections,
      )
      expect(result.degrees.length).toBeGreaterThan(0)
    })
  })
})
