import { useMemo, useState } from 'react'
import { Search, AlertTriangle } from 'lucide-react'

import { CV, CVTier, Requirement } from '../../api/types'
import { jobPositionsApi } from '../../api/endpoints'
import { Pill, TierPill } from '../ui/StatusPill'
import { FilterChips, ChipOption } from '../ui/FilterChips'
import CVDetailsModal from './CVDetailsModal'

type TierFilter = 'all' | CVTier

type SortKey = 'finalScore' | 'originalFilename' | 'yearsOfExperience' | 'tier'
type SortDir = 'asc' | 'desc'

const TIER_OPTIONS: ReadonlyArray<ChipOption<TierFilter>> = [
  { id: 'all', label: 'All' },
  { id: 'great', label: 'Great' },
  { id: 'good', label: 'Good' },
  { id: 'no-match', label: 'No match' },
]

const TIER_RANK: Record<CVTier, number> = { great: 3, good: 2, 'no-match': 1 }

export default function CVsTable({
  cvs,
  requirements,
  jobPositionId,
  onUpdate,
}: {
  cvs: CV[]
  requirements: Requirement[]
  jobPositionId: string
  onUpdate: () => void
}) {
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('finalScore')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedCvId, setSelectedCvId] = useState<string | null>(null)

  const selectedCv = useMemo(
    () => cvs.find((c) => c.id === selectedCvId) ?? null,
    [cvs, selectedCvId],
  )

  const rows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    const filtered = cvs.filter((cv) => {
      if (tierFilter !== 'all' && cv.tier !== tierFilter) return false
      if (
        normalizedSearch &&
        !cv.originalFilename.toLowerCase().includes(normalizedSearch)
      ) {
        return false
      }
      return true
    })

    return [...filtered].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortKey) {
        case 'finalScore':
          return ((a.finalScore ?? -1) - (b.finalScore ?? -1)) * dir
        case 'yearsOfExperience':
          return (
            (a.entities.yearsOfExperience - b.entities.yearsOfExperience) * dir
          )
        case 'tier':
          return ((TIER_RANK[a.tier ?? 'no-match'] ?? 0) -
            (TIER_RANK[b.tier ?? 'no-match'] ?? 0)) *
            dir
        case 'originalFilename':
          return a.originalFilename.localeCompare(b.originalFilename) * dir
      }
    })
  }, [cvs, tierFilter, search, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'originalFilename' ? 'asc' : 'desc')
    }
  }

  const handleOverride = async (cvId: string, tier: CVTier) => {
    await jobPositionsApi.overrideTier(jobPositionId, cvId, tier)
    onUpdate()
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <FilterChips
          label="Tier"
          options={TIER_OPTIONS}
          value={tierFilter}
          onChange={setTierFilter}
        />
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename…"
            className="w-56 rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 pl-9 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
          />
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            strokeWidth={1.75}
          />
        </div>
      </div>

      {selectedCv && (
        <CVDetailsModal
          cv={selectedCv}
          requirements={requirements}
          jobPositionId={jobPositionId}
          onClose={() => setSelectedCvId(null)}
          onUpdate={onUpdate}
        />
      )}

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {cvs.length === 0
              ? 'No CVs uploaded for this job position yet.'
              : 'No CVs match the current filters.'}
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader
                  label="Filename"
                  active={sortKey === 'originalFilename'}
                  dir={sortDir}
                  onClick={() => toggleSort('originalFilename')}
                />
                <SortHeader
                  label="Score"
                  active={sortKey === 'finalScore'}
                  dir={sortDir}
                  onClick={() => toggleSort('finalScore')}
                  align="right"
                />
                <SortHeader
                  label="Years"
                  active={sortKey === 'yearsOfExperience'}
                  dir={sortDir}
                  onClick={() => toggleSort('yearsOfExperience')}
                  align="right"
                />
                <th className="px-4 py-2 font-medium">Top skills</th>
                <SortHeader
                  label="Tier"
                  active={sortKey === 'tier'}
                  dir={sortDir}
                  onClick={() => toggleSort('tier')}
                />
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {rows.map((cv) => (
                <tr
                  key={cv.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => setSelectedCvId(cv.id)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {cv.originalFilename}
                      </span>
                      {cv.parsingConfidence === 'failed' ? (
                        <Pill tone="red">
                          <AlertTriangle
                            className="mr-1 h-3 w-3"
                            strokeWidth={2}
                          />
                          parse failed
                        </Pill>
                      ) : (
                        cv.parsingConfidence !== 'high' && (
                          <Pill tone="yellow">
                            {cv.parsingConfidence} confidence
                          </Pill>
                        )
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      #{cv.id.slice(-6)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-lg font-semibold text-gray-900">
                      {cv.finalScore?.toFixed(0) ?? '—'}
                    </span>
                    <span className="ml-1 text-xs text-gray-400">/100</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {cv.entities.yearsOfExperience}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {cv.entities.technologies.slice(0, 3).map((tech) => (
                        <span
                          key={tech}
                          className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
                        >
                          {tech}
                        </span>
                      ))}
                      {cv.entities.technologies.length > 3 && (
                        <span className="text-xs text-gray-400">
                          +{cv.entities.technologies.length - 3} more
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <TierPill tier={cv.tier} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <TierActions
                      currentTier={cv.tier}
                      onOverride={(tier) => handleOverride(cv.id, tier)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <th className={`px-4 py-2 font-medium ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition ${
          active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        {label}
        <span className="text-[10px]">
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}

function TierActions({
  currentTier,
  onOverride,
}: {
  currentTier: CVTier | null
  onOverride: (tier: CVTier) => void
}) {
  const actions: Array<{ tier: CVTier; label: string }> = [
    { tier: 'great', label: 'Great' },
    { tier: 'good', label: 'Good' },
    { tier: 'no-match', label: 'Reject' },
  ]
  return (
    <div
      className="inline-flex gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {actions
        .filter((a) => a.tier !== currentTier)
        .map((a) => (
          <button
            key={a.tier}
            type="button"
            onClick={() => onOverride(a.tier)}
            className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
          >
            {a.label}
          </button>
        ))}
    </div>
  )
}

