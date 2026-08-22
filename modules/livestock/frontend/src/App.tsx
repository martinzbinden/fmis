import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { DbProvider } from './db/DbContext'
import { isLoggedIn } from './db/auth'
import { startSyncLoop } from './db/sync'
import Layout from './components/Layout'
import Login from './pages/Login'
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

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())

  if (!loggedIn) {
    return <Login onLoggedIn={() => setLoggedIn(true)} />
  }

  return (
    <DbProvider>
      <AppShell onLoggedOut={() => setLoggedIn(false)} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
