import { useSeasonYears } from '../hooks/useSeasonYear'

/** Auswahl der Saison: Jahre mit Daten plus laufendes und nächstes. */
export default function SeasonYearSelect({ value, onChange, className = '' }: { value: number; onChange: (y: number) => void; className?: string }) {
  const years = useSeasonYears(value)
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Saison wählen"
      className={`min-h-11 min-w-0 rounded border border-gray-300 px-2 text-sm ${className}`}
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  )
}
