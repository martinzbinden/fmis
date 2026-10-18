import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import UpdatePrompt from './UpdatePrompt.tsx'
import './index.css'
import { requestPersistentStorage } from '@fmis/core/storagePersist'

void requestPersistentStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    <UpdatePrompt />
  </StrictMode>,
)
