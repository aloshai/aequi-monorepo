const AEQUI_URL = 'https://github.com/AequiDAO'

export function PoweredBy() {
  return (
    <footer className="powered-by">
      <a href={AEQUI_URL} target="_blank" rel="noopener noreferrer" className="powered-by__link">
        Powered by <span className="powered-by__brand">Aequi</span>
      </a>
    </footer>
  )
}
