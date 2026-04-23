import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Check,
  CircleDollarSign,
  FileText,
  GraduationCap,
  IdCard,
  type LucideIcon,
  MessageSquare,
  Minus,
  Paperclip,
  Puzzle,
  Wrench,
  X,
} from 'lucide-react'

import { CV, CVTier, Requirement } from '../../api/types'
import { jobPositionsApi } from '../../api/endpoints'
import { Pill, TierPill } from '../ui/StatusPill'

type ResumeTab = 'sections' | 'facts' | 'raw'

const SECTION_ORDER: Array<{
  key: keyof CV['sections']
  label: string
  Icon: LucideIcon
}> = [
  { key: 'summary', label: 'Summary', Icon: FileText },
  { key: 'experience', label: 'Experience', Icon: Briefcase },
  { key: 'skills', label: 'Skills', Icon: Wrench },
  { key: 'education', label: 'Education', Icon: GraduationCap },
  { key: 'other', label: 'Other', Icon: Paperclip },
]

export default function CVDetailsModal({
  cv,
  requirements,
  jobPositionId,
  onClose,
  onUpdate,
}: {
  cv: CV
  requirements: Requirement[]
  jobPositionId: string
  onClose: () => void
  onUpdate: () => void
}) {
  const [tab, setTab] = useState<ResumeTab>('sections')
  const [overriding, setOverriding] = useState<CVTier | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const parseFailed = cv.parsingConfidence === 'failed'
  const hasSections = useMemo(
    () =>
      SECTION_ORDER.some(
        ({ key }) => (cv.sections?.[key] ?? '').trim().length > 0,
      ),
    [cv.sections],
  )

  const handleOverride = async (tier: CVTier) => {
    setOverriding(tier)
    try {
      await jobPositionsApi.overrideTier(jobPositionId, cv.id, tier)
      onUpdate()
    } finally {
      setOverriding(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${cv.originalFilename}`}
    >
      <div
        className="flex h-[92vh] w-[min(1400px,96vw)] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          cv={cv}
          onClose={onClose}
          onOverride={handleOverride}
          overriding={overriding}
        />

        {parseFailed ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-xl rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-800">
              <AlertTriangle
                className="mx-auto h-8 w-8 text-red-500"
                strokeWidth={1.75}
              />
              <div className="mt-2 text-lg font-semibold">
                We couldn't read this file
              </div>
              <div className="mt-2 text-sm text-red-700">
                {cv.eliminationReason ??
                  'The parser could not extract any text from this file.'}
              </div>
              <div className="mt-4 text-xs text-red-700/80">
                This is usually a scanned / image-only PDF, a password-protected
                file, or a corrupted upload. Try re-exporting as a text-based
                PDF or DOCX and uploading again.
              </div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 divide-gray-200 md:grid-cols-2 md:divide-x">
            <ResumePane
              cv={cv}
              tab={tab}
              onTabChange={setTab}
              hasSections={hasSections}
            />
            <ScoringPane cv={cv} requirements={requirements} />
          </div>
        )}
      </div>
    </div>
  )
}

function ModalHeader({
  cv,
  onClose,
  onOverride,
  overriding,
}: {
  cv: CV
  onClose: () => void
  onOverride: (tier: CVTier) => void
  overriding: CVTier | null
}) {
  const tierActions: Array<{ tier: CVTier; label: string }> = [
    { tier: 'great', label: 'Mark great' },
    { tier: 'good', label: 'Mark good' },
    { tier: 'no-match', label: 'Reject' },
  ]
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-200 bg-gray-50/60 px-6 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-lg font-semibold text-gray-900">
            {cv.originalFilename}
          </h2>
          <TierPill tier={cv.tier} />
          {cv.parsingConfidence !== 'high' && (
            <Pill
              tone={cv.parsingConfidence === 'failed' ? 'red' : 'yellow'}
            >
              {cv.parsingConfidence === 'failed' ? (
                <>
                  <AlertTriangle className="mr-1 h-3 w-3" strokeWidth={2} />
                  parse failed
                </>
              ) : (
                `${cv.parsingConfidence} confidence`
              )}
            </Pill>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>
            Score:{' '}
            <span className="font-semibold text-gray-800">
              {cv.finalScore?.toFixed(0) ?? '—'}
            </span>
            /100
          </span>
          <span>{cv.entities.yearsOfExperience} yrs exp</span>
          {cv.aiModelUsed && <span>Model: {cv.aiModelUsed}</span>}
          {cv.aiCostUsd > 0 && (
            <span className="inline-flex items-center gap-1">
              <CircleDollarSign
                className="h-3.5 w-3.5 text-gray-400"
                strokeWidth={1.75}
              />
              ${cv.aiCostUsd.toFixed(4)}
            </span>
          )}
          <span className="text-gray-400">#{cv.id.slice(-6)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="hidden items-center gap-1 md:flex">
          {tierActions
            .filter((a) => a.tier !== cv.tier)
            .map((a) => (
              <button
                key={a.tier}
                type="button"
                disabled={overriding !== null}
                onClick={() => onOverride(a.tier)}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                {overriding === a.tier ? 'Saving…' : a.label}
              </button>
            ))}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-md p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

function ResumePane({
  cv,
  tab,
  onTabChange,
  hasSections,
}: {
  cv: CV
  tab: ResumeTab
  onTabChange: (t: ResumeTab) => void
  hasSections: boolean
}) {
  const tabs: Array<{ id: ResumeTab; label: string }> = [
    { id: 'sections', label: 'Sections' },
    { id: 'facts', label: 'Facts' },
    { id: 'raw', label: 'Raw text' },
  ]

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-gray-200 bg-white px-4 pt-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`rounded-t-md px-3 py-2 text-sm font-medium transition ${
              tab === t.id
                ? 'border-b-2 border-gray-900 text-gray-900'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto px-6 py-5">
        {tab === 'sections' &&
          (hasSections ? (
            <SectionsView cv={cv} />
          ) : (
            <EmptyHint
              title="No clean sections were detected"
              body="The section detector couldn't split this resume into summary / experience / skills / education. Try the Raw text tab to see the full extracted content."
            />
          ))}
        {tab === 'facts' && <FactsView cv={cv} />}
        {tab === 'raw' && <RawView cv={cv} />}
      </div>
    </div>
  )
}

function SectionsView({ cv }: { cv: CV }) {
  return (
    <div className="space-y-4">
      {SECTION_ORDER.map(({ key, label, Icon }) => {
        const value = (cv.sections?.[key] ?? '').trim()
        if (!value) return null
        return (
          <section
            key={key}
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          >
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-600">
              <Icon className="h-4 w-4 text-gray-400" strokeWidth={1.75} />
              {label}
            </h3>
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800">
              {value}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function FactsView({ cv }: { cv: CV }) {
  const { entities } = cv
  const groups: Array<{
    label: string
    Icon: LucideIcon
    items: string[]
    empty: string
  }> = [
    {
      label: 'Technologies',
      Icon: Puzzle,
      items: entities.technologies,
      empty: 'No technologies detected.',
    },
    {
      label: 'Roles',
      Icon: IdCard,
      items: entities.roles,
      empty: 'No roles detected.',
    },
    {
      label: 'Companies',
      Icon: Building2,
      items: entities.companies,
      empty: 'No companies detected.',
    },
    {
      label: 'Degrees',
      Icon: GraduationCap,
      items: entities.degrees,
      empty: 'No degrees detected.',
    },
  ]
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-gray-500">
          Years of experience
        </div>
        <div className="mt-1 text-2xl font-semibold text-gray-900">
          {entities.yearsOfExperience}
          <span className="ml-1 text-sm font-normal text-gray-500">years</span>
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.label}>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <g.Icon className="h-3.5 w-3.5 text-gray-400" strokeWidth={1.75} />
            {g.label}
          </h3>
          {g.items.length === 0 ? (
            <p className="text-sm italic text-gray-400">{g.empty}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {g.items.map((item) => (
                <span
                  key={item}
                  className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function RawView({ cv }: { cv: CV }) {
  if (!cv.rawText) {
    return (
      <EmptyHint
        title="No raw text available"
        body="This CV has no extracted text stored."
      />
    )
  }
  return (
    <pre className="whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 p-4 font-mono text-xs leading-relaxed text-gray-800">
      {cv.rawText}
    </pre>
  )
}

function EmptyHint({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
      <div className="font-medium text-gray-700">{title}</div>
      <div className="mt-1 text-xs text-gray-500">{body}</div>
    </div>
  )
}

function ScoringPane({
  cv,
  requirements,
}: {
  cv: CV
  requirements: Requirement[]
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-gray-200 bg-white px-6 pb-3 pt-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
          AI evaluation
        </h3>
      </div>
      <div className="flex-1 space-y-4 overflow-auto px-6 py-5">
        {cv.aiScores?.overallSummary ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
              Overall summary
            </div>
            <p>{cv.aiScores.overallSummary}</p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500">
            No AI summary for this CV. This usually means it was filtered out
            before the AI scoring stage — check the per-requirement breakdown
            below for the reason.
          </div>
        )}

        {cv.eliminationReason && (
          <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-white p-3 text-sm text-gray-700">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
              strokeWidth={1.75}
            />
            <span>{cv.eliminationReason}</span>
          </div>
        )}

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Per-requirement breakdown
          </h4>
          <div className="space-y-3">
            {requirements.map((req) => (
              <RequirementRow key={req.id} req={req} cv={cv} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function RequirementRow({ req, cv }: { req: Requirement; cv: CV }) {
  const aiScore = cv.aiScores?.scores.find((s) => s.requirementId === req.id)
  const kwScore = cv.keywordScores[req.id]
  const score = aiScore?.score ?? kwScore?.rawScore ?? 0
  const StatusIcon = score >= 0.8 ? Check : score > 0 ? Minus : X
  const statusTone =
    score >= 0.8
      ? 'text-gray-700'
      : score > 0
      ? 'text-gray-500'
      : 'text-gray-400'
  const matched = kwScore?.matchedSentences ?? []
  const source = aiScore ? 'AI' : 'Keyword'

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusIcon
          className={`h-4 w-4 ${statusTone}`}
          strokeWidth={2}
        />
        <span className="flex-1 text-sm font-medium text-gray-900">
          {req.text}
        </span>
        <span className="text-xs text-gray-500">
          weight {req.weight}
        </span>
        {req.isRequired && <Pill tone="red">required</Pill>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full transition-all ${
              score >= 0.8
                ? 'bg-gray-800'
                : score >= 0.5
                ? 'bg-gray-500'
                : score > 0
                ? 'bg-gray-400'
                : 'bg-gray-300'
            }`}
            style={{ width: `${Math.max(3, score * 100)}%` }}
          />
        </div>
        <span className="min-w-[3.5rem] text-right text-xs text-gray-600">
          {(score * 10).toFixed(1)}/10
        </span>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">
          {source}
        </span>
      </div>
      {aiScore?.evidence && (
        <p className="mt-2 border-l-2 border-gray-300 pl-2 text-xs italic text-gray-600">
          “{aiScore.evidence}”
        </p>
      )}
      {aiScore?.reasoning && (
        <p className="mt-1 text-xs text-gray-700">{aiScore.reasoning}</p>
      )}
      {matched.length > 0 && (
        <details className="mt-2 text-xs text-gray-600">
          <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-700">
            Keyword matches ({matched.length})
          </summary>
          <ul className="mt-1 space-y-1 pl-4">
            {matched.slice(0, 6).map((s, i) => (
              <li
                key={i}
                className="border-l-2 border-gray-200 pl-2 text-gray-600"
              >
                {s}
              </li>
            ))}
            {matched.length > 6 && (
              <li className="text-gray-400">
                +{matched.length - 6} more matches
              </li>
            )}
          </ul>
        </details>
      )}
    </div>
  )
}
