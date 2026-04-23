import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

import { jobPositionsApi } from '../api/endpoints'
import { JobStatusPill } from '../components/ui/StatusPill'
import CVDropzone from '../components/cvs/CVDropzone'
import CVGeneratorForm, {
  CVGeneratorParams,
} from '../components/cvs/CVGeneratorForm'

type Tab = 'upload' | 'generate'

const SUBMIT_SPLASH_MS = 3000

export default function UploadCvs() {
  const { jobPositionId } = useParams<{ jobPositionId: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('upload')
  const [error, setError] = useState<string | null>(null)
  const [submittedKind, setSubmittedKind] = useState<'upload' | 'generate' | null>(
    null,
  )

  useEffect(() => {
    if (!submittedKind || !jobPositionId) return
    const t = window.setTimeout(
      () => navigate(`/dashboard?jobId=${jobPositionId}`),
      SUBMIT_SPLASH_MS,
    )
    return () => window.clearTimeout(t)
  }, [submittedKind, jobPositionId, navigate])

  const jobQuery = useQuery({
    queryKey: ['jobPosition', jobPositionId],
    queryFn: () => jobPositionsApi.get(jobPositionId!),
    enabled: !!jobPositionId,
  })

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) =>
      jobPositionsApi.uploadCvs(jobPositionId!, files),
    onSuccess: () => setSubmittedKind('upload'),
    onError: (err: any) => setError(serverMessage(err) ?? 'Upload failed'),
  })

  const generateMutation = useMutation({
    mutationFn: (params: CVGeneratorParams) =>
      jobPositionsApi.generateCvs(jobPositionId!, params),
    onSuccess: () => setSubmittedKind('generate'),
    onError: (err: any) =>
      setError(serverMessage(err) ?? 'Failed to generate CVs'),
  })

  const handleUpload = (files: File[]) => {
    if (files.length === 0) return
    setError(null)
    uploadMutation.mutate(files)
  }

  const handleGenerate = (params: CVGeneratorParams) => {
    setError(null)
    generateMutation.mutate(params)
  }

  if (submittedKind) return <SubmitSplash kind={submittedKind} />

  if (jobQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    )
  }

  if (!jobQuery.data) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        Could not load this job position.{' '}
        <Link to="/dashboard" className="font-medium underline">
          Back to dashboard
        </Link>
      </div>
    )
  }

  const job = jobQuery.data
  const isReady =
    job.status === 'REQUIREMENTS_EXTRACTED' ||
    job.status === 'PROCESSING' ||
    job.status === 'COMPLETED'

  if (!isReady) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-yellow-200 bg-yellow-50 p-6 text-yellow-800">
        Requirements aren't ready yet for{' '}
        <strong>{job.title}</strong>. You'll be able to upload CVs once
        extraction finishes.
        <Link
          to={`/dashboard?jobId=${job.id}`}
          className="ml-2 font-medium underline"
        >
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          to={`/dashboard?jobId=${job.id}`}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← Back to dashboard
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{job.title}</h1>
          <JobStatusPill status={job.status} />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {job.totalCvs} CV{job.totalCvs === 1 ? '' : 's'} already on this
          position. Add more below.
        </p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-4">
          <TabButton active={tab === 'upload'} onClick={() => setTab('upload')}>
            Upload CVs
          </TabButton>
          <TabButton
            active={tab === 'generate'}
            onClick={() => setTab('generate')}
          >
            Generate CVs
          </TabButton>
        </nav>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {tab === 'upload' ? (
        <CVDropzone
          onUpload={handleUpload}
          isSubmitting={uploadMutation.isPending}
        />
      ) : (
        <CVGeneratorForm
          onGenerate={handleGenerate}
          isSubmitting={generateMutation.isPending}
        />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-1 pb-3 text-sm font-medium transition ${
        active
          ? 'border-gray-900 text-gray-900'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

function SubmitSplash({ kind }: { kind: 'upload' | 'generate' }) {
  const isGenerate = kind === 'generate'
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
        <div className="mb-4 flex justify-center">
          <Loader2
            className="h-10 w-10 animate-spin text-brand-600"
            strokeWidth={1.75}
          />
        </div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          {isGenerate ? 'Generating CVs with AI' : 'Uploading CVs'}
        </h2>
        <p className="text-sm text-gray-600">
          {isGenerate
            ? 'Each CV is written and scored in the background. Taking you to the dashboard — rows will appear as they are processed.'
            : 'Parsing and scoring in the background. Taking you to the dashboard…'}
        </p>
      </div>
    </div>
  )
}

function serverMessage(err: any): string | null {
  const msg =
    err?.response?.data?.message?.message ??
    err?.response?.data?.message ??
    err?.message
  if (Array.isArray(msg)) return msg.join('; ')
  if (typeof msg === 'string') return msg
  return null
}
