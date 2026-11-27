import { Link, useNavigate } from 'react-router-dom'

/** «‹ Zurück» zur vorigen Seite der App (Tier-Info, Merkliste, Durchgang …); ohne
 * Vorgeschichte (direkt geöffnet) zur Liste `to` (Vorgabe: eine Stufe höher). */
export default function BackLink({ allLabel, to }: { allLabel: string; to?: string }) {
  const navigate = useNavigate()
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  if (canGoBack)
    return (
      <button type="button" onClick={() => navigate(-1)} className="link-btn inline-flex min-h-11 items-center text-sm text-brand-700">
        ‹ Zurück
      </button>
    )
  return to ? (
    <Link to={to} className="link-btn inline-flex min-h-11 items-center text-sm text-brand-700">
      {allLabel}
    </Link>
  ) : (
    <Link to=".." relative="path" className="link-btn inline-flex min-h-11 items-center text-sm text-brand-700">
      {allLabel}
    </Link>
  )
}
