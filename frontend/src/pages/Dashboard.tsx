import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { CircleDollarSign, FileText, Loader2 } from 'lucide-react'

import { jobPositionsApi } from '../api/endpoints'
import {
  JobPosition,
  PipelineStage,
  Requirement,
  ResultsResponse,
} from '../api/types'

const STAGE_LABELS: Record<PipelineStage, string> = {
  parsing: 'Parsing CVs…',
  filtering: 'Filtering candidates…',
  scoring: 'Scoring with AI…',
  completed: 'Finishing up…',
  failed: 'Failed',
}
import JobsTable from '../components/jobs/JobsTable'
import RequirementsEditor from '../components/jobs/RequirementsEditor'
import CVsTable from '../components/cvs/CVsTable'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { JobStatusPill } from '../components/ui/StatusPill'

export default function Dashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  // Polls every 2s while any row is mid-extraction so "Extracting…" flips without a manual refresh.
  const jobsQuery = useQuery({
    queryKey: ['jobPositions'],
    queryFn: jobPositionsApi.list,
    refetchInterval: (query) => {
      const hasExtracting = (query.state.data ?? []).some(
        (j) => j.status === 'EXTRACTING_REQUIREMENTS',
      )
      return hasExtracting ? 2000 : false
    },
  })

  const jobs = jobsQuery.data ?? []

  const selectedId = useMemo<string | null>(() => {
    const fromUrl = searchParams.get('jobId')
    if (fromUrl && jobs.some((j) => j.id === fromUrl)) return fromUrl
    return jobs[0]?.id ?? null
  }, [jobs, searchParams])

  const selectJob = (id: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('jobId', id)
    setSearchParams(next, { replace: true })
  }

  // DB-backed progress poll during PROCESSING — survives backend restarts, no SSE dependency.
  const progressQuery = useQuery({
    queryKey: ['progress', selectedId],
    queryFn: () => jobPositionsApi.getProgress(selectedId!),
    enabled: !!selectedId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'PROCESSING' ? 2000 : false
    },
  })

  // Heavy query, polled every 3s during PROCESSING so streamed CV rows appear incrementally.
  const resultsQuery = useQuery({
    queryKey: ['results', selectedId],
    queryFn: () => jobPositionsApi.getResults(selectedId!),
    enabled: !!selectedId,
    refetchInterval: () => {
      const status = progressQuery.data?.status
      return status === 'PROCESSING' ? 3000 : false
    },
  })

  const progressStatus = progressQuery.data?.status
  useEffect(() => {
    if (progressStatus === 'COMPLETED' || progressStatus === 'FAILED') {
      resultsQuery.refetch()
      queryClient.invalidateQueries({ queryKey: ['jobPositions'] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressStatus, selectedId])

  const [editingJob, setEditingJob] = useState<JobPosition | null>(null)
  const [deletingJob, setDeletingJob] = useState<JobPosition | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => jobPositionsApi.delete(id),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['jobPositions'] })
      if (selectedId === deletedId) {
        const next = new URLSearchParams(searchParams)
        next.delete('jobId')
        setSearchParams(next, { replace: true })
      }
      setDeletingJob(null)
    },
  })

  const saveRequirementsMutation = useMutation({
    mutationFn: async ({
      id,
      requirements,
    }: {
      id: string
      requirements: Requirement[]
    }) => {
      await jobPositionsApi.updateRequirements(id, requirements)
      await jobPositionsApi.rescore(id)
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['jobPositions'] })
      queryClient.invalidateQueries({ queryKey: ['results', vars.id] })
      setEditingJob(null)
    },
  })

  const retryExtractionMutation = useMutation({
    mutationFn: (id: string) => jobPositionsApi.extractRequirements(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobPositions'] })
    },
  })

  useEffect(() => {
    if (!searchParams.get('jobId') && selectedId) {
      const next = new URLSearchParams(searchParams)
      next.set('jobId', selectedId)
      setSearchParams(next, { replace: true })
    }
  }, [selectedId, searchParams, setSearchParams])

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Job Positions</h1>
          <p className="text-sm text-gray-500">
            Manage your open positions and the CVs ranked against them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/job-positions/new')}
          aria-label="New job position"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white shadow-sm transition hover:bg-gray-800"
        >
          +
        </button>
      </div>

      {jobsQuery.isLoading ? (
        <div className="flex flex-1 items-center justify-center text-gray-500">
          Loading…
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          <section className="flex w-[420px] shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
            <SectionHeader title="Positions" count={jobs.length} />
            <JobsTable
              jobs={jobs}
              selectedId={selectedId}
              onSelect={selectJob}
              onEdit={setEditingJob}
              onDelete={setDeletingJob}
              onUploadCvs={(job) =>
                navigate(`/job-positions/${job.id}/upload-cvs`)
              }
              onRetryExtraction={(job) =>
                retryExtractionMutation.mutate(job.id)
              }
            />
          </section>

          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
            {selectedId ? (
              <SelectedJobPane
                jobPositionId={selectedId}
                resultsQuery={resultsQuery}
                livePipelineStage={progressQuery.data?.currentStage ?? null}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
                Select a job position on the left to view its CVs.
              </div>
            )}
          </section>
        </div>
      )}

      {editingJob && (
        <EditRequirementsModal
          job={editingJob}
          onCancel={() => setEditingJob(null)}
          onSave={(requirements) =>
            saveRequirementsMutation.mutate({ id: editingJob.id, requirements })
          }
          isSaving={saveRequirementsMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deletingJob}
        title="Delete this job position?"
        message={
          <>
            This permanently removes{' '}
            <span className="font-medium text-gray-900">
              {deletingJob?.title}
            </span>{' '}
            and all{' '}
            <span className="font-medium text-gray-900">
              {deletingJob?.totalCvs ?? 0}
            </span>{' '}
            CVs uploaded to it. This action cannot be undone.
          </>
        }
        confirmLabel={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        onCancel={() => setDeletingJob(null)}
        onConfirm={() => deletingJob && deleteMutation.mutate(deletingJob.id)}
      />
    </div>
  )
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50/60 px-4 py-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
        {title}
      </h2>
      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
        {count}
      </span>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white p-12">
      <div className="text-center">
        <p className="text-gray-600">You don't have any job positions yet.</p>
        <Link
          to="/job-positions/new"
          className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline"
        >
          Create your first job position →
        </Link>
      </div>
    </div>
  )
}

function SelectedJobPane({
  jobPositionId,
  resultsQuery,
  livePipelineStage,
}: {
  jobPositionId: string
  resultsQuery: UseQueryResult<ResultsResponse>
  livePipelineStage: PipelineStage | null
}) {
  if (resultsQuery.isLoading || !resultsQuery.data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        Loading CVs…
      </div>
    )
  }

  const { jobPosition, ranked } = resultsQuery.data
  const requirements = jobPosition.requirements as Requirement[]
  const allCvs = [...ranked.great, ...ranked.good, ...ranked.noMatch]
  const isProcessing = jobPosition.status === 'PROCESSING'
  const stageLabel =
    STAGE_LABELS[livePipelineStage ?? jobPosition.currentStage ?? 'parsing']

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-gray-900">
              {jobPosition.title}
            </h2>
            <JobStatusPill status={jobPosition.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-gray-400" strokeWidth={1.75} />
              {jobPosition.totalCvs} CVs
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              {ranked.great.length} great
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-yellow-500" />
              {ranked.good.length} good
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-gray-400" />
              {ranked.noMatch.length} no match
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CircleDollarSign
                className="h-3.5 w-3.5 text-gray-400"
                strokeWidth={1.75}
              />
              ${jobPosition.aiCostUsd.toFixed(3)}
            </span>
            {isProcessing && (
              <span className="inline-flex items-center gap-1.5 text-gray-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                {stageLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      <CVsTable
        cvs={allCvs}
        requirements={requirements}
        jobPositionId={jobPositionId}
        onUpdate={resultsQuery.refetch}
      />
    </div>
  )
}

function EditRequirementsModal({
  job,
  onCancel,
  onSave,
  isSaving,
}: {
  job: JobPosition
  onCancel: () => void
  onSave: (requirements: Requirement[]) => void
  isSaving: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-gray-900/40 p-4 pt-10"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Edit requirements
          </h2>
          <p className="text-sm text-gray-500">
            Saving will re-score all existing CVs against the updated
            requirements.
          </p>
          <p className="mt-1 text-xs text-gray-400">{job.title}</p>
        </div>
        <RequirementsEditor
          requirements={job.requirements}
          submitLabel="Save & re-score"
          onCancel={onCancel}
          onConfirm={onSave}
          isSubmitting={isSaving}
        />
      </div>
    </div>
  )
}
