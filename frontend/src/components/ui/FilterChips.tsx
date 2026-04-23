export interface ChipOption<T extends string> {
  id: T
  label: React.ReactNode
}

export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string
  options: ReadonlyArray<ChipOption<T>>
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && (
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {label}:
        </span>
      )}
      {options.map((opt) => {
        const active = opt.id === value
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              active
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
