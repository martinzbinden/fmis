/** Bittet den Browser, die lokale Datenbank (PGlite in IndexedDB) und die
 * Ausgangsliste NICHT von sich aus zu räumen. Ohne diese Zusage darf
 * besonders Safari (nicht als App installiert) Daten löschen, wenn der
 * Speicher knapp wird — auch solche, die noch nicht auf dem Server sind.
 * Ein Nein ist kein Fehler (der Browser entscheidet, oft erst nach
 * Installation oder häufiger Nutzung); gefragt wird beim Start und nach
 * jeder Anmeldung wieder. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
