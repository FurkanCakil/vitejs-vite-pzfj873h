import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const root = createRoot(document.getElementById('root')!)
if (import.meta.env.EUROPE_PREVIEW_QA && new URLSearchParams(location.search).get('europeQa') === '1') {
  void import('./qa/EuropePreviewQA.jsx').then(({ default: EuropePreviewQA }) => root.render(<EuropePreviewQA />))
} else {
  root.render(<StrictMode><App /></StrictMode>)
}
