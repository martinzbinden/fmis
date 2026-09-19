import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DbProvider } from './db/DbContext'
import { AuthUserProvider } from './db/AuthContext'
import { isLoggedIn } from './db/auth'
import { startSyncLoop } from './db/sync'
import Layout from './components/Layout'
import Login from './pages/Login'
import VerifyToken from './pages/VerifyToken'
import Fields from './pages/Fields'
import Rotation from './pages/Rotation'
import History from './pages/History'
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
    return <Login onLoggedIn={() => setLoggedIn(true)} />
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
        <Route path="/" element={<Fields />} />
        <Route path="/fruchtfolge" element={<Rotation />} />
        <Route path="/verlauf" element={<History />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
