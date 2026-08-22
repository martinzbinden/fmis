import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DbProvider } from './db/DbContext'
import { AuthUserProvider } from './db/AuthContext'
import { isLoggedIn } from './db/auth'
import { startSyncLoop } from './db/sync'
import Layout from './components/Layout'
import Login from './pages/Login'
import VerifyToken from './pages/VerifyToken'
import Dashboard from './pages/Dashboard'
import Animals from './pages/Animals'
import AnimalDetail from './pages/AnimalDetail'
import Groups from './pages/Groups'
import GroupDetail from './pages/GroupDetail'
import Erfassen from './pages/Erfassen'
import WeighIn from './pages/WeighIn'
import MedicationEntry from './pages/MedicationEntry'
import FeedEntry from './pages/FeedEntry'
import SlaughterEntry from './pages/SlaughterEntry'
import Economics from './pages/Economics'
import Admin from './pages/Admin'

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())
  const location = useLocation()

  // /verify muss auch OHNE bestehende Session erreichbar sein (der
  // Magic-Link-Klick tauscht den Token erst noch gegen ein Session-JWT).
  if (location.pathname === '/verify') {
    return <VerifyToken onVerified={() => setLoggedIn(true)} />
  }

  if (!loggedIn) {
    return <Login />
  }

  return (
    <DbProvider>
      <AuthUserProvider>
        <AppShell onLoggedOut={() => setLoggedIn(false)} />
      </AuthUserProvider>
    </DbProvider>
  )
}

function AppShell({ onLoggedOut }: { onLoggedOut: () => void }) {
  useEffect(() => {
    startSyncLoop()
  }, [])

  return (
    <Layout onLoggedOut={onLoggedOut}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tiere" element={<Animals />} />
        <Route path="/tiere/:id" element={<AnimalDetail />} />
        <Route path="/gruppen" element={<Groups />} />
        <Route path="/gruppen/:id" element={<GroupDetail />} />
        <Route path="/erfassen" element={<Erfassen />} />
        <Route path="/gewichte" element={<WeighIn />} />
        <Route path="/medikamente" element={<MedicationEntry />} />
        <Route path="/futter" element={<FeedEntry />} />
        <Route path="/schlachtung" element={<SlaughterEntry />} />
        <Route path="/wirtschaftlichkeit" element={<Economics />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
