import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ChartApp } from './ChartApp.js'
import './chart.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChartApp />
  </StrictMode>,
)
