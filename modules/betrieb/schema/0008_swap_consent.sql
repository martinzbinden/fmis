-- Abtausch unter Mitarbeitenden: die Gegenpartei (to_person) stimmt zu oder lehnt ab.
-- Mit Zustimmung führt der Server den Tausch sofort aus und informiert das Büro;
-- bei Ablehnung entscheidet das Büro (Weisungsrecht).
alter table duty_requests add column counter_status text
  check (counter_status is null or counter_status in ('offen', 'zugestimmt', 'abgelehnt'));
alter table duty_requests add column counter_at timestamptz;
