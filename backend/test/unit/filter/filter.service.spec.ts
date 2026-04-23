import { FilterService } from '../../../src/filter/filter.service'
import { ParsedCV, Requirement } from '../../../src/common/types'

describe('FilterService', () => {
  let service: FilterService

  const reqs: Requirement[] = [
    {
      id: 'r1',
      text: 'Node.js experience',
      type: 'technology',
      weight: 9,
      isRequired: true,
      keywords: ['node.js', 'nodejs'],
      synonyms: ['express'],
    },
    {
      id: 'r2',
      text: 'Kubernetes',
      type: 'technology',
      weight: 9,
      isRequired: true,
      keywords: ['kubernetes', 'k8s'],
      synonyms: [],
    },
    {
      id: 'r3',
      text: 'AWS',
      type: 'technology',
      weight: 4,
      isRequired: false,
      keywords: ['aws'],
      synonyms: [],
    },
  ]

  const baseCV = (sentences: string[]): ParsedCV => ({
    rawText: sentences.join('. '),
    sections: {
      experience: sentences.join('. '),
      skills: '',
      education: '',
      summary: '',
      other: '',
    },
    sentences,
    entities: {
      yearsOfExperience: 5,
      technologies: [],
      degrees: [],
      companies: [],
      roles: [],
    },
    parsingConfidence: 'high',
  })

  beforeEach(() => {
    service = new FilterService()
  })

  it('returns no-match when enough required requirements are missing (ratio 0.6 on 2 required → limit 2)', () => {
    const cv = baseCV(['Built applications with Python'])
    const result = service.filter(cv, reqs)
    expect(result.preliminaryTier).toBe('no-match')
    expect(result.missingRequiredCount).toBe(2)
    expect(result.eliminationReason).toContain('required')
  })

  it('returns great when all required are strongly matched', () => {
    const cv = baseCV([
      'Built Node.js services',
      'Deployed Node.js to production',
      'Scaled Node.js apps',
      'Managed Kubernetes clusters',
      'Deployed to Kubernetes',
      'Kubernetes expert',
      'Used AWS for hosting',
      'AWS infrastructure experience',
      'Set up AWS services',
    ])
    const result = service.filter(cv, reqs)
    expect(result.preliminaryTier).toBe('great')
  })

  it('returns good when required are met but weaker', () => {
    const cv = baseCV([
      'Worked with Node.js recently',
      'Some exposure to Kubernetes',
    ])
    const result = service.filter(cv, reqs)
    expect(result.preliminaryTier).toBe('good')
  })

  it('scores matched sentences per requirement', () => {
    const cv = baseCV([
      'Node.js expert for 5 years',
      'Built Node.js microservices',
    ])
    const result = service.filter(cv, reqs)
    expect(result.keywordScores['r1'].matchedSentences.length).toBe(2)
    expect(result.keywordScores['r1'].rawScore).toBeGreaterThan(0)
  })

  it('matches synonyms (e.g. express for Node.js)', () => {
    const cv = baseCV(['Built Express APIs'])
    const result = service.filter(cv, reqs)
    expect(result.keywordScores['r1'].matchedSentences.length).toBe(1)
  })
})
