-- Meine Links: persönliche Verweise je Benutzer auf der Startseite (z.B. ein Chat, ein Portal). Nur die Person
-- selbst sieht und ändert sie (core/backend/fmis_core/user_links.py), über die E-Mail-Adresse wie notifications.
create table user_links (
  id uuid primary key,
  owner text not null,
  title text not null,
  url text not null,
  icon text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_user_links_owner on user_links (lower(owner)) where deleted_at is null;
