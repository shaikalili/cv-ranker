import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { FileText } from 'lucide-react'

export default function CVDropzone({
  onUpload,
  isSubmitting,
}: {
  onUpload: (files: File[]) => void | Promise<void>
  isSubmitting: boolean
}) {
  const [files, setFiles] = useState<File[]>([])

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [...prev, ...accepted])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        ['.docx'],
      'text/plain': ['.txt'],
    },
  })

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition ${
          isDragActive
            ? 'border-gray-900 bg-gray-50'
            : 'border-gray-300 bg-white hover:border-gray-400'
        }`}
      >
        <input {...getInputProps()} />
        <p className="text-gray-700">
          {isDragActive
            ? 'Drop files here…'
            : 'Drag & drop CVs, or click to select'}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Supports PDF, DOCX, and TXT. Multiple files OK.
        </p>
      </div>

      {files.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-medium text-gray-700">
            {files.length} file{files.length > 1 ? 's' : ''} queued
          </h3>
          <ul className="space-y-1 text-sm text-gray-600">
            {files.slice(0, 10).map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <FileText
                  className="h-3.5 w-3.5 text-gray-400"
                  strokeWidth={1.75}
                />
                {f.name}
              </li>
            ))}
            {files.length > 10 && (
              <li className="italic text-gray-400">
                +{files.length - 10} more
              </li>
            )}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => onUpload(files)}
        disabled={files.length === 0 || isSubmitting}
        className="rounded-md bg-brand-600 px-4 py-2 text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        {isSubmitting
          ? 'Uploading…'
          : files.length === 0
          ? 'Select files to upload'
          : `Process ${files.length} CV${files.length > 1 ? 's' : ''} →`}
      </button>
    </div>
  )
}
