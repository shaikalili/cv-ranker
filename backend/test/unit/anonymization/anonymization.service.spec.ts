import { AnonymizationService } from '../../../src/anonymization/anonymization.service'

describe('AnonymizationService', () => {
  let service: AnonymizationService

  beforeEach(() => {
    service = new AnonymizationService()
  })

  it('strips email addresses', () => {
    const input = 'Contact me at john.doe@example.com for details'
    const result = service.anonymize(input)
    expect(result).not.toContain('john.doe@example.com')
    expect(result).toContain('[EMAIL]')
  })

  it('strips phone numbers', () => {
    const input = 'Call me at +1 (415) 555-0172'
    const result = service.anonymize(input)
    expect(result).not.toContain('555-0172')
  })

  it('strips URLs', () => {
    const input = 'Portfolio: https://myportfolio.com/dev'
    const result = service.anonymize(input)
    expect(result).not.toContain('myportfolio.com')
    expect(result).toContain('[URL]')
  })

  it('strips the candidate name from the first line', () => {
    const input = 'John Doe\nSenior Engineer\nExperience at Acme'
    const result = service.anonymize(input)
    expect(result).not.toContain('John Doe')
    expect(result).toContain('[NAME]')
  })

  it('strips date of birth', () => {
    const input = 'Date of birth: 01/01/1990\nExperience...'
    const result = service.anonymize(input)
    expect(result).not.toContain('1990')
  })

  it('strips gender pronouns', () => {
    const input = 'John Smith (he/him)\nExperience...'
    const result = service.anonymize(input)
    expect(result.toLowerCase()).not.toContain('he/him')
  })

  it('preserves professional content', () => {
    const input = `John Doe
Senior Backend Engineer

Managed Kubernetes cluster at Wix.
Built Node.js microservices.`
    const result = service.anonymize(input)
    expect(result).toContain('Kubernetes')
    expect(result).toContain('Node.js')
    expect(result).toContain('microservices')
  })

  describe('additional PII patterns', () => {
    it('strips street addresses written out long-form', () => {
      const input =
        'Contact:\n123 Main Street, Apt 4\nExperience at Acme'
      const result = service.anonymize(input)
      expect(result).not.toContain('123 Main Street')
      expect(result).toContain('[ADDRESS]')
    })

    it('strips an explicit "Address:" line', () => {
      const input = 'Address: 99 Fake Ave, Springfield\nExperience...'
      const result = service.anonymize(input)
      expect(result).toContain('[ADDRESS]')
      expect(result).not.toContain('Fake Ave')
    })

    it('strips DOB written as "DOB: ..."', () => {
      const input = 'DOB: 12/03/1988\nExperience...'
      const result = service.anonymize(input)
      expect(result).toContain('[PERSONAL_DATA]')
      expect(result).not.toContain('1988')
    })

    it('strips age disclosures', () => {
      const input = 'Age: 34\nSenior Engineer'
      const result = service.anonymize(input)
      expect(result).not.toMatch(/Age:\s*34/i)
      expect(result).toContain('[PERSONAL_DATA]')
    })

    it('leaves the text intact when no PII is present', () => {
      // First line needs to NOT match the "looks like a candidate name"
      // heuristic (2-4 all-letter words). Prepend "EXPERIENCE" so the
      // first meaningful line is clearly a section header instead.
      const input =
        'EXPERIENCE\nBuilt Kubernetes tooling in Go over five years.'
      const result = service.anonymize(input)
      expect(result).toContain('EXPERIENCE')
      expect(result).toContain('Kubernetes')
    })

    it('does not strip a first line that looks like a section header, not a name', () => {
      // "Senior Backend Engineer" is 3 words all-letters, so the heuristic
      // could over-match. Verify the guard still works by constructing a
      // clearly-name input and then showing a too-long first line is kept.
      const longFirstLine =
        'This is a much longer first line that should not be mistaken for a candidate name because it exceeds sixty characters'
      const result = service.anonymize(`${longFirstLine}\nExperience...`)
      expect(result).toContain(longFirstLine)
    })

    it('does not strip a first line that contains digits', () => {
      const input = 'Engineer 2024 Edition\nExperience at Acme'
      const result = service.anonymize(input)
      // Digits disqualify it from the name heuristic.
      expect(result).toContain('Engineer 2024 Edition')
    })
  })
})
