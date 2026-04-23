import { Link, useLocation } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'

interface NavItem {
  to: string
  label: string
  icon: string
  matchPrefix?: string
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠', matchPrefix: '/dashboard' },
  {
    to: '/job-positions/new',
    label: 'New Job Position',
    icon: '➕',
    matchPrefix: '/job-positions/new',
  },
]

export default function Sidebar({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuth()
  const location = useLocation()

  const isActive = (item: NavItem) =>
    location.pathname.startsWith(item.matchPrefix ?? item.to)

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-5">
        <span className="text-xl">🎯</span>
        <span className="text-base font-semibold text-gray-900">CV Ranker</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive(item)
                ? 'bg-gray-900 text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="border-t border-gray-200 p-4">
        <div className="mb-3 text-sm">
          <div className="font-medium text-gray-900">{user?.name}</div>
          <div className="truncate text-xs text-gray-500">{user?.email}</div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Log out
        </button>
      </div>
    </aside>
  )
}
