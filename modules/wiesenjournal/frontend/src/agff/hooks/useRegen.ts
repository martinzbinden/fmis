// Regenmengen von graswachstum.ch (lib/regen.ts) für ein Jahr: holt sie, wenn nötig (beim Öffnen, wenn das Netz
// zurückkommt, wenn Parzellen dazukommen), und liefert den Zwischenspeicher des Geräts.
import { useEffect } from 'react'
import { db } from '../db/db'
import { REGEN_KEY, regenAktualisieren, type RegenSpeicher } from '../lib/regen'
import { useQuery } from './useQuery'

export function useRegen(jahr: number): RegenSpeicher {
  const { data } = useQuery((s) => ({ speicher: s.getSetting<RegenSpeicher>(REGEN_KEY, {}), parzellen: s.rows('parcels').length }), [])
  useEffect(() => {
    const holen = () => void regenAktualisieren(db(), jahr)
    holen()
    window.addEventListener('online', holen)
    return () => window.removeEventListener('online', holen)
  }, [jahr, data.parzellen])
  return data.speicher
}
