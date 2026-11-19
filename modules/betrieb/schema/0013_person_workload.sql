-- Dienstplan je Person: Anstellung in % (null = nicht angestellt, z.B. Familie), davon Schule/ÜK in % (Lehrling;
-- die Schultage selbst kommen als Abwesenheit). Die Planung verteilt Dienste grob nach dem Pensum am Betrieb
-- (Anstellung − Schule) × Vollzeit-Stunden (lib/workload.ts).
-- absence_with: Ferien gemeinsam mit (z.B. Paar) — gleichzeitige Abwesenheit gilt im Ferienplan nicht als Überschneidung.
alter table duty_people add column employment_pct integer check (employment_pct is null or employment_pct between 0 and 100);
alter table duty_people add column school_pct integer check (school_pct is null or school_pct between 0 and 100);
alter table duty_people add column absence_with uuid;
