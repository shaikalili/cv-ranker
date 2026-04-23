import { Outlet, useNavigate } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import Sidebar from './Sidebar'

export default function Layout() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar onLogout={handleLogout} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="h-full overflow-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
