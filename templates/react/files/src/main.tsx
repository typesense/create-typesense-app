import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// No index.css: the starter's stylesheet pins #root to a fixed-width centred column.
// biome-ignore lint/style/noNonNullAssertion: index.html always has #root.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
