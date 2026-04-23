import { SectionDetectorService } from '../../../src/parser/section-detector.service'

describe('SectionDetectorService', () => {
  let service: SectionDetectorService

  beforeEach(() => {
    service = new SectionDetectorService()
  })

  describe('detect()', () => {
    it('dumps everything to `other` when no headers are present', () => {
      const text = 'A flat block of text with no section headers anywhere.'
      const result = service.detect(text)
      expect(result.other).toContain('A flat block')
      expect(result.experience).toBe('')
      expect(result.skills).toBe('')
    })

    it('splits a resume across experience / skills / education', () => {
      const text = [
        'Summary',
        'Senior backend engineer.',
        '',
        'Experience',
        'Acme Corp — Senior Engineer',
        'Built Node.js services.',
        '',
        'Skills',
        'Node.js, Kubernetes, AWS',
        '',
        'Education',
        'BSc Computer Science',
      ].join('\n')

      const result = service.detect(text)

      expect(result.summary).toContain('Senior backend engineer')
      expect(result.experience).toContain('Acme Corp')
      expect(result.skills).toContain('Kubernetes')
      expect(result.education).toContain('Computer Science')
    })

    it('is case-insensitive on header matching', () => {
      const text = 'EXPERIENCE\nBuilt stuff.\n\nSKILLS\nNode.js'
      const result = service.detect(text)
      expect(result.experience).toContain('Built stuff')
      expect(result.skills).toContain('Node.js')
    })

    it('recognises common alternative headers (employment, competencies, profile)', () => {
      // Each header lives on its own line because the section-marker regex
      // requires `\s*` between line-start and the keyword — a header like
      // "Core Competencies" would not match "competencies" (the "Core "
      // breaks the `\s*`). That's intentional: we'd rather miss a rare
      // wrap-around than split on a stray in-sentence mention.
      const text = [
        'Profile',
        'Engineer who ships.',
        '',
        'Employment History',
        'Widget Co — Developer',
        '',
        'Competencies',
        'TypeScript, SQL',
      ].join('\n')

      const result = service.detect(text)

      expect(result.summary).toContain('Engineer who ships')
      expect(result.experience).toContain('Widget Co')
      expect(result.skills).toContain('TypeScript')
    })
  })

  describe('splitIntoSentences()', () => {
    it('splits on sentence-terminal punctuation followed by whitespace', () => {
      const result = service.splitIntoSentences(
        'Built Node.js services. Managed Kubernetes! Deployed to AWS?',
      )
      expect(result).toEqual([
        'Built Node.js services.',
        'Managed Kubernetes!',
        'Deployed to AWS?',
      ])
    })

    it('splits on newlines (PDF-style line breaks)', () => {
      const result = service.splitIntoSentences(
        'Senior Engineer\nBuilt microservices\nShipped to prod',
      )
      expect(result).toEqual([
        'Senior Engineer',
        'Built microservices',
        'Shipped to prod',
      ])
    })

    it('splits on bullet glyphs that PDFs often emit inline', () => {
      // Mix of the bullet characters the service claims to handle.
      const result = service.splitIntoSentences(
        '• Built APIs ▪ Scaled clusters · Mentored team',
      )
      expect(result).toEqual(expect.arrayContaining([
        'Built APIs',
        'Scaled clusters',
        'Mentored team',
      ]))
    })

    it('drops fragments shorter than 3 characters (including 2-char skills)', () => {
      // The source comment aspires to keep Go / C# etc., but the actual
      // threshold is length >= 3, so those do get dropped. Pin that
      // behaviour so a future widening (if it happens) shows up as a
      // deliberate change of this test rather than a silent regression.
      const result = service.splitIntoSentences(
        'I\nGo\nC#\nSQL\nJavaScript',
      )
      expect(result).not.toContain('I')
      expect(result).not.toContain('Go')
      expect(result).not.toContain('C#')
      expect(result).toEqual(expect.arrayContaining(['SQL', 'JavaScript']))
    })

    it('returns an empty array for blank input', () => {
      expect(service.splitIntoSentences('')).toEqual([])
      expect(service.splitIntoSentences('\n\n  \n')).toEqual([])
    })
  })
})
