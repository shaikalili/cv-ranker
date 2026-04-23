import { Navigate, Route, Routes, useParams } from 'react-router-dom'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewJobPosition from './pages/NewJobPosition'
import UploadCvs from './pages/UploadCvs'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

function LegacyResultsRedirect() {
  const { jobPositionId } = useParams<{ jobPositionId: string }>()
  return <Navigate to={`/dashboard?jobId=${jobPositionId ?? ''}`} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/job-positions/new" element={<NewJobPosition />} />
        <Route
          path="/job-positions/:jobPositionId/upload-cvs"
          element={<UploadCvs />}
        />
        <Route
          path="/job-positions/:jobPositionId/results"
          element={<LegacyResultsRedirect />}
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
