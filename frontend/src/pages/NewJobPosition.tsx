import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { jobPositionsApi } from '../api/endpoints'

export default function NewJobPosition() {
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [jobDescriptionText, setJobDescriptionText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  useEffect(() => {
    if (!createdId) return
    const timeoutId = window.setTimeout(() => {
      navigate(`/dashboard?jobId=${createdId}`)
    }, 2000)
    return () => window.clearTimeout(timeoutId)
  }, [createdId, navigate])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const created = await jobPositionsApi.create(title, jobDescriptionText)
      // Fire-and-forget; dashboard polling reflects completion/failure.
      jobPositionsApi.extractRequirements(created.id).catch((err) => {
        console.error('Failed to queue requirement extraction', err)
      })
      setCreatedId(created.id)
    } catch {
      setError('Failed to create job position. Please try again.')
      setIsSubmitting(false)
    }
  }

  if (createdId) {
    return <CreatedSplash />
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-2xl font-semibold text-gray-900">
        New Job Position
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        Paste your job description below. AI will extract weighted requirements
        in the background while you return to the dashboard.
      </p>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Position title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={3}
              placeholder="e.g. Senior Backend Engineer — Q2"
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Job description
            </label>
            <textarea
              value={jobDescriptionText}
              onChange={(e) => setJobDescriptionText(e.target.value)}
              required
              minLength={50}
              rows={12}
              placeholder="Paste your full job description here..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-gray-900 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              You'll be able to review and edit extracted requirements from the
              dashboard once they're ready.
            </p>
          </div>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating…' : 'Create job position →'}
        </button>
      </form>
    </div>
  )
}

function CreatedSplash() {
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
          Job position created
        </h2>
        <p className="text-sm text-gray-600">
          Extracting requirements in the background. Taking you to the
          dashboard…
        </p>
      </div>
    </div>
  )
}
