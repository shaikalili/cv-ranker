import { JobPositionStatus, CVTier } from '../../api/types'

type PillTone = 'green' | 'yellow' | 'red' | 'blue' | 'orange' | 'gray'

const TONES: Record<PillTone, string> = {
  green: 'bg-green-100 text-green-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  orange: 'bg-orange-100 text-orange-700',
  gray: 'bg-gray-100 text-gray-600',
}

export function Pill({
  tone,
  children,
}: {
  tone: PillTone
  children: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

const JOB_STATUS_TONE: Record<JobPositionStatus, PillTone> = {
  CREATED: 'gray',
  EXTRACTING_REQUIREMENTS: 'orange',
  REQUIREMENTS_EXTRACTED: 'blue',
  PROCESSING: 'yellow',
  COMPLETED: 'green',
  FAILED: 'red',
}

const JOB_STATUS_LABEL: Record<JobPositionStatus, string> = {
  CREATED: 'Created',
  EXTRACTING_REQUIREMENTS: 'Extracting…',
  REQUIREMENTS_EXTRACTED: 'Ready',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
}

export function JobStatusPill({ status }: { status: JobPositionStatus }) {
  return <Pill tone={JOB_STATUS_TONE[status]}>{JOB_STATUS_LABEL[status]}</Pill>
}

const TIER_TONE: Record<CVTier, PillTone> = {
  great: 'green',
  good: 'yellow',
  'no-match': 'red',
}

const TIER_LABEL: Record<CVTier, string> = {
  great: 'Great',
  good: 'Good',
  'no-match': 'No match',
}

export function TierPill({ tier }: { tier: CVTier | null }) {
  if (!tier) return <Pill tone="gray">—</Pill>
  return <Pill tone={TIER_TONE[tier]}>{TIER_LABEL[tier]}</Pill>
}
