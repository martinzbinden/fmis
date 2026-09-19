-- history:read für alle bestehenden Rollen ergänzen (Audit-Log ist reine
-- Transparenz, kein sensibler Bereich — auch "Nur Lesen" darf es sehen).
-- Kein history:write nötig: der Sync-Endpunkt lässt data_history-Zeilen
-- unabhängig vom Rollenmodell durch, siehe backend/app/sync.py — sie
-- entstehen immer als Nebeneffekt einer im selben Request bereits
-- berechtigten Schreibung auf einer anderen Tabelle.
update roles
set permissions = permissions || array['history:read']
where not ('history:read' = any(permissions));
