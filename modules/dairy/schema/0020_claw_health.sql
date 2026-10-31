-- Klauengesundheit (pages/ClawEntry.tsx, lib/clawHealth.ts). Je Tier und Untersuchung eine
-- claw_exams-Zeile (Lahmheit, geschnitten, Behandlung), die Befunde je Fuss in claw_findings.
-- Rinder: Befundschlüssel nach ICAR-Klauengesundheitsatlas (wie im Schweizer
-- Klauengesundheitsprojekt), Lahmheit 1–5 (Locomotion Score). Schafe: Moderhinke-Score 0–5
-- je Fuss (code 'MH', grade = Score; auch 0 wird gespeichert = Fuss angeschaut, gesund).
create table claw_exams (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  exam_date date not null,
  round_id uuid,
  examiner text,
  locomotion smallint,
  trimmed boolean not null default false,
  treatment text,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'reader', 'import')),
  recorded_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table claw_findings (
  id uuid primary key,
  exam_id uuid not null references claw_exams(id),
  animal_id uuid not null references animals(id),
  foot text check (foot in ('VL', 'VR', 'HL', 'HR')),
  claw text check (claw in ('innen', 'aussen')),
  code text not null,
  grade text,
  zone smallint,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index claw_exams_animal on claw_exams (animal_id, exam_date);
create index claw_exams_round on claw_exams (round_id);
create index claw_findings_exam on claw_findings (exam_id);
