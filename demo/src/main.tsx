import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './figtree.css' // generato da scripts/font.mjs: Figtree incorporato, nessuna richiesta a Google Fonts
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
