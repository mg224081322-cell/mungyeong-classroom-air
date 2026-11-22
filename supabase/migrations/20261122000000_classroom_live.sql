-- Separate storage for the Vercel CO₂ pilot. Existing action records are not changed.
create schema if not exists classroom_private;
revoke all on schema classroom_private from public;

create table if not exists classroom_private.classroom_live (
  room text primary key check (room = 'pilot'),
  device_digest text,
  threshold integer not null default 1000 check (threshold between 400 and 5000),
  minutes integer not null default 5 check (minutes between 1 and 60),
  ppm integer check (ppm between 250 and 10000),
  measured_at bigint,
  received_at bigint,
  above_since bigint,
  disconnected integer not null default 0 check (disconnected in (0, 1)),
  revision bigint not null default 0
);

create table if not exists classroom_private.classroom_pin_limit (
  id integer primary key check (id = 1),
  bucket bigint not null,
  attempts integer not null check (attempts between 1 and 50)
);

alter table classroom_private.classroom_live enable row level security;
alter table classroom_private.classroom_pin_limit enable row level security;
revoke all on classroom_private.classroom_live, classroom_private.classroom_pin_limit from public;
