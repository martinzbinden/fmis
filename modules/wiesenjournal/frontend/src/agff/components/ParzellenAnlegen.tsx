// FMIS-Fassung (HERKUNFT.json «lokal»): Im FMIS kommen die Parzellen aus dem Kulturen-Modul (GELAN) und werden auf
// der Seite «Parzellen» übernommen. Darum hier kein Import, kein Zeichnen und kein Beispielbetrieb, nur der Weg dorthin.
import { Link } from '../fmis/router'

export default function ParzellenAnlegen(_props: { variante: 'kacheln' | 'plus'; mitBeispiel?: boolean }) {
  return (
    <div className="card space-y-2 px-4 py-3 text-sm text-gray-700" data-testid="anlegen-kacheln">
      <p>Für dieses Jahr sind noch keine Parzellen im Journal.</p>
      <p className="text-xs text-gray-600">Im FMIS kommen sie aus dem Kulturen-Modul (GELAN). Auf der Seite «Parzellen» mit «Aus GELAN übernehmen» holen.</p>
      <Link to="/parzellen" className="btn-primary">
        🌱 Zu den Parzellen
      </Link>
    </div>
  )
}
