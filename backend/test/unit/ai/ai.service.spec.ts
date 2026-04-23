import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { getLoggerToken } from 'nestjs-pino'

import { AiService } from '../../../src/ai/ai.service'
import { makeRequirement } from '../../helpers/factories'
import {
  KeywordScores,
  ParsedCV,
  Requirement,
} from '../../../src/common/types'

/**
 * Minimal PinoLogger double. `startOp`/`jobLogger` in `common/logging.ts`
 * reach for `.logger` first and fall back to the object itself, so we
 * expose methods directly and leave `.logger` unset — the helper then
 * invokes our mock methods.
 */
function makeLogger() {
  const fns = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    trace: jest.fn(),
    debug: jest.fn(),
  }
  return {
    ...fns,
    child: jest.fn(() => ({ ...fns, child: jest.fn() })),
    setContext: jest.fn(),
  }
}

function makeConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    OPENAI_API_KEY: 'sk-test-0000',
    AI_MODEL_CHEAP: 'gpt-5-mini',
    AI_MODEL_PREMIUM: 'gpt-5.1',
    AI_CONCURRENCY_LIMIT: '5',
    ...overrides,
  }
  return {
    get: jest.fn(<T = string>(key: string, fallback?: T): T => {
      return (values[key] as unknown as T) ?? (fallback as T)
    }),
  }
}

/** Shape of the object we swap into `(service as any).openai`. */
type MockOpenAI = {
  chat: { completions: { create: jest.Mock } }
}

function makeOpenAIMock(): MockOpenAI {
  return {
    chat: { completions: { create: jest.fn() } },
  }
}

/**
 * Craft a successful OpenAI response wrapping `content` as the assistant
 * message. Matches the subset of the SDK shape the service reads.
 */
function okResponse(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  }
}

describe('AiService', () => {
  let service: AiService
  let openai: MockOpenAI

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: makeConfig() },
        { provide: getLoggerToken(AiService.name), useValue: makeLogger() },
      ],
    }).compile()
    service = module.get(AiService)
    service.onModuleInit()

    // Replace the real OpenAI client with our mock. The service reads
    // `this.openai.chat.completions.create(...)` directly.
    openai = makeOpenAIMock()
    ;(service as unknown as { openai: MockOpenAI }).openai = openai
  })

  describe('extractRequirements', () => {
    it('parses a happy-path response and assigns req_N ids', async () => {
      openai.chat.completions.create.mockResolvedValue(
        okResponse(
          JSON.stringify({
            requirements: [
              {
                text: 'Node.js',
                type: 'technology',
                weight: 9,
                isRequired: true,
                keywords: ['node'],
                synonyms: [],
              },
              {
                text: 'Kubernetes',
                type: 'technology',
                weight: 8,
                isRequired: true,
                keywords: ['k8s'],
                synonyms: [],
              },
            ],
          }),
        ),
      )

      const { requirements, costUsd } =
        await service.extractRequirements('Looking for a backend engineer...')

      expect(requirements).toHaveLength(2)
      expect(requirements[0].id).toBe('req_1')
      expect(requirements[1].id).toBe('req_2')
      expect(costUsd).toBeGreaterThan(0)
    })

    it('throws when the LLM returns invalid JSON (parse failure)', async () => {
      openai.chat.completions.create.mockResolvedValue(
        okResponse('{"requirements": [ not json at all'),
      )

      await expect(
        service.extractRequirements('...'),
      ).rejects.toThrow()
    })

    it('throws when the LLM returns an empty requirements array', async () => {
      openai.chat.completions.create.mockResolvedValue(
        okResponse(JSON.stringify({ requirements: [] })),
      )

      await expect(service.extractRequirements('...')).rejects.toThrow(
        /no usable requirements/i,
      )
    })

    it('filters out structurally-invalid entries but keeps good ones', async () => {
      openai.chat.completions.create.mockResolvedValue(
        okResponse(
          JSON.stringify({
            requirements: [
              { text: 'AWS', type: 'technology', weight: 5, isRequired: false, keywords: ['aws'], synonyms: [] },
              { wrongShape: true }, // missing text/keywords → dropped
              null, // dropped
              { text: 'Docker', type: 'technology', weight: 5, isRequired: false, keywords: ['docker'] }, // no synonyms → defaulted
            ],
          }),
        ),
      )

      const { requirements } = await service.extractRequirements('...')

      expect(requirements).toHaveLength(2)
      expect(requirements.map((r) => r.text)).toEqual(['AWS', 'Docker'])
      // Missing `synonyms` should have been defaulted, not preserved as undefined.
      expect(Array.isArray(requirements[1].synonyms)).toBe(true)
    })

    it('throws when every entry fails schema validation', async () => {
      openai.chat.completions.create.mockResolvedValue(
        okResponse(
          JSON.stringify({ requirements: [null, {}, { wrongShape: 1 }] }),
        ),
      )

      await expect(service.extractRequirements('...')).rejects.toThrow()
    })

    it('re-throws network/model errors', async () => {
      openai.chat.completions.create.mockRejectedValue(
        new Error('network down'),
      )

      // Retries happen inside callWithRetry; for this case we don't want
      // to sit through 3s of backoff, so stub the timer.
      const originalSetTimeout = global.setTimeout
      jest
        .spyOn(global, 'setTimeout')
        .mockImplementation(((cb: () => void) => {
          cb()
          return 0 as unknown as NodeJS.Timeout
        }) as typeof setTimeout)

      await expect(service.extractRequirements('...')).rejects.toThrow(
        /network down/i,
      )

      global.setTimeout = originalSetTimeout
    })
  })

  describe('scoreBatch / scoreSingle', () => {
    const reqs: Requirement[] = [
      makeRequirement({ id: 'r1', text: 'Node.js', isRequired: true }),
    ]

    function fakeCv(): ParsedCV {
      return {
        rawText: 'Built Node.js services',
        sections: { experience: '', skills: '', education: '', summary: '', other: '' },
        sentences: ['Built Node.js services'],
        entities: {
          yearsOfExperience: 5,
          technologies: [],
          degrees: [],
          companies: [],
          roles: [],
        },
        parsingConfidence: 'high',
      }
    }

    const keywordScores: KeywordScores = {
      r1: { matchedSentences: ['Built Node.js services'], rawScore: 1.0 },
    }

    it('returns aiScores for a single candidate on success', async () => {
      openai.chat.completions.create.mockResolvedValue(
        okResponse(
          JSON.stringify({
            scores: [
              { requirementId: 'r1', score: 0.8, reasoning: '', evidence: '' },
            ],
            overallSummary: 'solid fit',
          }),
        ),
      )

      const [result] = await service.scoreBatch(
        [
          {
            cvId: 'cv-1',
            cv: fakeCv(),
            anonymizedText: 'anon',
            keywordScores,
            tier: 'good',
          },
        ],
        reqs,
      )

      expect(result.cvId).toBe('cv-1')
      expect(result.aiScores?.scores[0].score).toBe(0.8)
      expect(result.costUsd).toBeGreaterThan(0)
      expect(result.error).toBeUndefined()
    })

    it('returns aiScores: null on invalid JSON (does NOT throw, keeps batch alive)', async () => {
      openai.chat.completions.create.mockResolvedValue(
        okResponse('{"scores": not valid json'),
      )

      const [result] = await service.scoreBatch(
        [
          {
            cvId: 'cv-1',
            cv: fakeCv(),
            anonymizedText: '',
            keywordScores,
            tier: 'good',
          },
        ],
        reqs,
      )

      expect(result.aiScores).toBeNull()
      expect(result.error).toMatch(/valid json|not valid/i)
      // Cost is still charged because the completion did run end-to-end.
      expect(result.costUsd).toBeGreaterThan(0)
    })

    it('returns aiScores: null when the OpenAI call itself fails after retries', async () => {
      openai.chat.completions.create.mockRejectedValue(new Error('429 rate limit'))
      const originalSetTimeout = global.setTimeout
      jest
        .spyOn(global, 'setTimeout')
        .mockImplementation(((cb: () => void) => {
          cb()
          return 0 as unknown as NodeJS.Timeout
        }) as typeof setTimeout)

      const [result] = await service.scoreBatch(
        [
          {
            cvId: 'cv-1',
            cv: fakeCv(),
            anonymizedText: '',
            keywordScores,
            tier: 'good',
          },
        ],
        reqs,
      )

      expect(result.aiScores).toBeNull()
      expect(result.error).toMatch(/rate limit|429/i)
      expect(result.costUsd).toBe(0) // no tokens consumed from our side

      global.setTimeout = originalSetTimeout
    })

    it('uses the premium model for great-tier candidates', async () => {
      openai.chat.completions.create.mockResolvedValue(
        okResponse(
          JSON.stringify({
            scores: [
              { requirementId: 'r1', score: 1, reasoning: '', evidence: '' },
            ],
            overallSummary: '',
          }),
        ),
      )

      await service.scoreBatch(
        [
          {
            cvId: 'cv-1',
            cv: fakeCv(),
            anonymizedText: '',
            keywordScores,
            tier: 'great',
          },
        ],
        reqs,
      )

      const call = openai.chat.completions.create.mock.calls[0][0] as {
        model: string
      }
      expect(call.model).toBe('gpt-5.1')
    })
  })

  describe('generateCvContent', () => {
    it('returns sanitized content + cost on success', async () => {
      openai.chat.completions.create.mockResolvedValue(
        okResponse(
          JSON.stringify({
            name: 'Alice Example',
            email: 'alice@example.com',
            yearsExperience: 6,
            summary: 'Backend engineer.',
            experience: [
              {
                company: 'Acme',
                role: 'Engineer',
                startYear: 2020,
                endYear: 2024,
                bullets: ['Built Node.js services'],
              },
            ],
            skills: ['Node.js', 'Kubernetes'],
            education: 'BSc CS',
          }),
        ),
      )

      const result = await service.generateCvContent({
        jobTitle: 'Senior Backend',
        tier: 'strong',
        requirements: [makeRequirement({ id: 'r1' })],
      })

      expect(result.content.name).toBe('Alice Example')
      expect(result.content.experience).toHaveLength(1)
      expect(result.costUsd).toBeGreaterThan(0)
      expect(result.modelUsed).toBe('gpt-5-mini')
    })

    it('survives invalid JSON by falling back to sanitizer defaults', async () => {
      openai.chat.completions.create.mockResolvedValue(
        okResponse('{not valid'),
      )

      const result = await service.generateCvContent({
        jobTitle: 'Senior Backend',
        tier: 'partial',
        requirements: [makeRequirement({ id: 'r1' })],
      })

      // The sanitizer fills in safe defaults so downstream consumers
      // (PDF/DOCX generators) don't crash on missing fields.
      expect(result.content.name).toBe('Candidate')
      expect(result.content.experience).toEqual([])
      expect(result.content.skills).toEqual([])
    })
  })
})
