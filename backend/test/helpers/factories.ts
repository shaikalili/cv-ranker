/**
 * Shared test fixtures — every spec that needs a `Requirement`, `ParsedCV`,
 * or `CV` row should build it through one of these helpers instead of
 * hand-rolling literals. Keeps specs focused on the behaviour under test and
 * makes future schema additions a one-line change here.
 *
 * All builders accept a `Partial<...>` override so callers can tweak only
 * the fields relevant to the assertion.
 */
import { CV } from '@prisma/client'

import {
  AIScoreResponse,
  KeywordScores,
  ParsedCV,
  Requirement,
  RequirementType,
} from '../../src/common/types'

let reqCounter = 0

export function makeRequirement(
  overrides: Partial<Requirement> = {},
): Requirement {
  reqCounter += 1
  return {
    id: `r${reqCounter}`,
    text: 'Node.js experience',
    type: 'technology' as RequirementType,
    weight: 9,
    isRequired: true,
    keywords: ['node.js', 'nodejs'],
    synonyms: ['express'],
    ...overrides,
  }
}

export function resetRequirementCounter(): void {
  reqCounter = 0
}

export function makeParsedCV(overrides: Partial<ParsedCV> = {}): ParsedCV {
  const sentences = overrides.sentences ?? [
    'Built Node.js microservices',
    'Managed Kubernetes clusters',
  ]
  return {
    rawText: overrides.rawText ?? sentences.join('. '),
    sections: overrides.sections ?? {
      experience: sentences.join('. '),
      skills: '',
      education: '',
      summary: '',
      other: '',
    },
    sentences,
    entities: overrides.entities ?? {
      yearsOfExperience: 5,
      technologies: [],
      degrees: [],
      companies: [],
      roles: [],
    },
    parsingConfidence: overrides.parsingConfidence ?? 'high',
    ...(overrides.parseError !== undefined
      ? { parseError: overrides.parseError }
      : {}),
  }
}

export function makeKeywordScores(
  reqIds: string[],
  perReq: Partial<KeywordScores[string]> = {},
): KeywordScores {
  const base: KeywordScores = {}
  for (const id of reqIds) {
    base[id] = {
      matchedSentences: [],
      rawScore: 0.5,
      ...perReq,
    }
  }
  return base
}

export function makeAIScoreResponse(
  perReq: Array<{ requirementId: string; score: number }>,
  overallSummary = '',
): AIScoreResponse {
  return {
    overallSummary,
    scores: perReq.map((p) => ({
      requirementId: p.requirementId,
      score: p.score,
      reasoning: '',
      evidence: '',
    })),
  }
}

/**
 * Build a CV row that mirrors Prisma's `CV` model shape. Used by the DB-layer
 * tests (`ResumeService`) where we stub the Prisma client and need realistic
 * return values.
 */
export function makeCvRow(overrides: Partial<CV> = {}): CV {
  return {
    id: 'cv-1',
    jobPositionId: 'job-1',
    originalFilename: 'resume.pdf',
    mimeType: 'application/pdf',
    rawText: 'Built Node.js microservices. Managed Kubernetes clusters.',
    anonymizedText: '[NAME]\nBuilt Node.js microservices.',
    sections: { experience: '', skills: '', education: '', summary: '', other: '' },
    sentences: ['Built Node.js microservices'],
    entities: {
      yearsOfExperience: 5,
      technologies: [],
      degrees: [],
      companies: [],
      roles: [],
    },
    parsingConfidence: 'high',
    keywordScores: {},
    tier: 'good',
    finalScore: 70,
    eliminationReason: null,
    aiScores: null,
    aiModelUsed: null,
    aiCostUsd: 0,
    createdAt: new Date('2026-04-22T00:00:00Z'),
    ...overrides,
  }
}
