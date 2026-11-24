import { shortEarTag } from '@fmis/core/earTag'

/** Hinweis auf Seiten mit Durchgang (Trächtigkeit, Klauen): das Tier aus der Tier-Info (?tier=) ist vorgewählt,
 * erst muss der Durchgang laufen. */
export default function PresetHint({ animal, next }: { animal: { lauf_nr?: string | null; ear_tag: string; name?: string | null }; next?: string }) {
  return (
    <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
      Vorgewählt:{' '}
      <strong>
        {animal.lauf_nr ? `${animal.lauf_nr} · ` : ''}
        {shortEarTag(animal.ear_tag)}
        {animal.name ? ` ${animal.name}` : ''}
      </strong>{' '}
      – {next ?? 'Durchgang starten oder einen früheren fortsetzen'}, danach ist das Tier gewählt.
    </p>
  )
}
