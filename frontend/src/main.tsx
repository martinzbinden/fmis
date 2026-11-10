import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import UpdatePrompt from './UpdatePrompt.tsx'
import './index.css'
import { requestPersistentStorage } from '@fmis/core/storagePersist'
import { checkInstance, datenstandText } from '@fmis/core/instance'

void requestPersistentStorage()

// Testumgebung: vor dem Öffnen der lokalen Datenbank den Datenstand prüfen (core/instance.ts)
void checkInstance().then((info) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {info.instanz && (
        <div className="bg-amber-300 px-3 py-1 text-center text-xs font-semibold text-amber-950">
          🧪 Testumgebung — Daten von Prod{datenstandText(info.datenstand) ? ` (Stand ${datenstandText(info.datenstand)})` : ''}. Änderungen hier gehen beim
          nächsten Update verloren.
        </div>
      )}
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <UpdatePrompt />
    </StrictMode>,
  )
})
