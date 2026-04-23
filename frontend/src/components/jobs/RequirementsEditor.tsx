import { useEffect, useState } from 'react'

import { Requirement } from '../../api/types'

export default function RequirementsEditor({
  requirements,
  submitLabel = 'Save',
  onCancel,
  onConfirm,
  isSubmitting = false,
}: {
  requirements: Requirement[]
  submitLabel?: string
  onCancel?: () => void
  onConfirm: (reqs: Requirement[]) => void
  isSubmitting?: boolean
}) {
  const [reqs, setReqs] = useState<Requirement[]>(requirements)

  useEffect(() => {
    setReqs(requirements)
  }, [requirements])

  const updateReq = (id: string, patch: Partial<Requirement>) => {
    setReqs((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const removeReq = (id: string) => {
    setReqs((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Review & edit requirements ({reqs.length})
        </h2>
        {reqs.length === 0 ? (
          <p className="text-sm text-gray-500">No requirements defined.</p>
        ) : (
          <div className="space-y-3">
            {reqs.map((req) => (
              <div
                key={req.id}
                className="rounded-lg border border-gray-200 p-3"
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      updateReq(req.id, { isRequired: !req.isRequired })
                    }
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                      req.isRequired
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {req.isRequired ? 'Required' : 'Nice to have'}
                  </button>
                  <input
                    type="text"
                    value={req.text}
                    onChange={(e) =>
                      updateReq(req.id, { text: e.target.value })
                    }
                    className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeReq(req.id)}
                    className="shrink-0 text-sm text-red-600 hover:text-red-800"
                    aria-label="Remove requirement"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-3 pl-2">
                  <label className="text-xs text-gray-500">
                    Weight: {req.weight}
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={req.weight}
                    onChange={(e) =>
                      updateReq(req.id, { weight: Number(e.target.value) })
                    }
                    className="flex-1"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => onConfirm(reqs)}
          disabled={isSubmitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
