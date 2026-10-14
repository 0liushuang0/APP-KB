import { useState, useEffect, useCallback } from 'react'
import AppRouter from './router'
import OfflineBanner from './components/OfflineBanner'
import OnboardingWizard from './components/OnboardingWizard'
import PrivacyConsent from './components/PrivacyConsent'
import KeyboardShortcuts from './components/KeyboardShortcuts'
import UpdateNotification from './components/UpdateNotification'
import BackendFreshness from './components/BackendFreshness'
import { useSystemNameStore } from './store/systemNameStore'

function App() {
  const [showConsent, setShowConsent] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const fetchName = useSystemNameStore((s) => s.fetchName)

  useEffect(() => {
    fetchName()
  }, [fetchName])

  useEffect(() => {
    const consent = localStorage.getItem('aikb-privacy-consent')
    if (!consent) {
      setShowConsent(true)
    }
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault()
      setShowShortcuts((prev) => !prev)
    }
    if (e.key === 'Escape') {
      setShowShortcuts(false)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <>
      <OfflineBanner />
      {!showConsent && <OnboardingWizard />}
      <AppRouter />
      {showConsent && (
        <PrivacyConsent onAccept={() => setShowConsent(false)} />
      )}
      <KeyboardShortcuts isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <UpdateNotification />
      <BackendFreshness />
    </>
  )
}

export default App
