import { FormEvent, useState } from 'react'

export interface CVGeneratorParams {
  count: number
  qualityMix: { strong: number; partial: number; weak: number }
  format: 'pdf' | 'docx'
}

export default function CVGeneratorForm({
  onGenerate,
  isSubmitting,
}: {
  onGenerate: (params: CVGeneratorParams) => void | Promise<void>
  isSubmitting: boolean
}) {
  const [count, setCount] = useState(10)
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf')
  const [strong, setStrong] = useState(30)
  const [partial, setPartial] = useState(40)

  const weak = Math.max(0, 100 - strong - partial)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onGenerate({
      count,
      qualityMix: {
        strong: strong / 100,
        partial: partial / 100,
        weak: weak / 100,
      },
      format,
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-gray-200 bg-white p-6"
    >
      <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-600">
        Generates synthetic CVs aligned with this job's extracted requirements
        and scores them against it — useful for demos and testing. All data is
        fictional.
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Number of CVs: {count}
        </label>
        <input
          type="range"
          min={1}
          max={50}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          Quality mix
        </label>
        <div className="space-y-2">
          <Slider
            label="Strong matches"
            value={strong}
            onChange={setStrong}
            accent="text-green-700"
          />
          <Slider
            label="Partial matches"
            value={partial}
            onChange={setPartial}
            accent="text-yellow-700"
          />
          <div className="text-sm text-gray-600">
            Weak matches: <strong>{weak}%</strong>
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Format
        </label>
        <div className="flex gap-2">
          {(['pdf', 'docx'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`rounded-md border px-4 py-1.5 text-sm transition ${
                format === f
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-brand-600 py-2 text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        {isSubmitting ? 'Generating & ingesting…' : `Generate ${count} CVs →`}
      </button>
    </form>
  )
}

function Slider({
  label,
  value,
  onChange,
  accent,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  accent?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`flex-1 text-sm text-gray-700 ${accent ?? ''}`}>
        {label}: <strong>{value}%</strong>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
    </div>
  )
}
