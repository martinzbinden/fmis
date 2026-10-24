-- Benachrichtigungen (Glocke oben) und E-Mail je Profileinstellung.
-- Empfänger über die E-Mail-Adresse (auch Personen, die noch nie angemeldet waren).
create table notifications (
  id uuid primary key,
  recipient text not null,
  kind text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz
);
create index idx_notifications_recipient on notifications (lower(recipient), created_at desc);

-- Profileinstellung: Benachrichtigungen auch per E-Mail (Standard ein)
alter table users add column notify_email boolean not null default true;
