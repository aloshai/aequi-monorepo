import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import './styles/tailwind.css'
import './index.css'
import App from './App.tsx'
import { Landing } from './pages/Landing.tsx'
import { wagmiConfig } from './lib/wagmi.ts'

const queryClient = new QueryClient()

// Apply persisted theme before first paint to avoid a flash. Default light.
;(() => {
  try {
    const raw = localStorage.getItem('aequi_theme')
    const theme = raw ? JSON.parse(raw)?.state?.theme : 'light'
    document.documentElement.classList.toggle('dark', theme === 'dark')
  } catch {
    /* default light */
  }
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/app" element={<App />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
