import { Upload, Pencil, Trash2, RefreshCw } from 'lucide-react'

import { JobPosition } from '../../api/types'
import { JobStatusPill } from '../ui/StatusPill'

export default function JobsTable({
  jobs,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onUploadCvs,
  onRetryExtraction,
}: {
  jobs: JobPosition[]
  selectedId: string | null
  onSelect: (id: string) => void
  onEdit: (job: JobPosition) => void
  onDelete: (job: JobPosition) => void
  onUploadCvs: (job: JobPosition) => void
  onRetryExtraction: (job: JobPosition) => void
}) {
  return (
    <div className="flex-1 overflow-auto">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 text-right font-medium">CVs</th>
            <th className="px-4 py-2" aria-label="Actions" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {jobs.map((job) => {
            const selected = job.id === selectedId
            // Retry is safe — backend's extractRequirements is idempotent on CREATED/FAILED.
            const needsExtraction =
              job.status === 'CREATED' || job.status === 'FAILED'
            return (
              <tr
                key={job.id}
                onClick={() => onSelect(job.id)}
                className={`cursor-pointer transition ${
                  selected
                    ? 'border-l-2 border-gray-900 bg-gray-50'
                    : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{job.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {new Date(job.createdAt).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <JobStatusPill status={job.status} />
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {job.totalCvs}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    {needsExtraction && (
                      <IconButton
                        label="Retry extraction"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRetryExtraction(job)
                        }}
                      >
                        <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                      </IconButton>
                    )}
                    <IconButton
                      label="Upload CVs"
                      onClick={(e) => {
                        e.stopPropagation()
                        onUploadCvs(job)
                      }}
                    >
                      <Upload className="h-4 w-4" strokeWidth={1.75} />
                    </IconButton>
                    <IconButton
                      label="Edit requirements"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(job)
                      }}
                    >
                      <Pencil className="h-4 w-4" strokeWidth={1.75} />
                    </IconButton>
                    <IconButton
                      label="Delete job position"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(job)
                      }}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
    >
      {children}
    </button>
  )
}
