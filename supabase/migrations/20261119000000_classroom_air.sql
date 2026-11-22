create table if not exists public.sensor_logs (
  id uuid primary key,
  session_id uuid not null,
  measured_at timestamptz not null,
  humidity double precision not null check (humidity between 0 and 100),
  temperature double precision not null check (temperature between -50 and 100),
  noise double precision check (noise between 0 and 1000),
  prediction text not null check (prediction in ('measuring', 'ok', 'ventilate')),
  source text not null check (source = 'serial')
);

create table if not exists public.alert_logs (
  id uuid primary key,
  session_id uuid not null,
  alert_id uuid not null references public.alert_logs(id),
  event_at timestamptz not null,
  source text not null check (source = 'serial'),
  kind text not null check (kind in ('alert', 'action')),
  air_grade text check (air_grade in ('좋음', '보통', '나쁨', '매우 나쁨')),
  advice text,
  action text,
  check ((kind = 'alert' and id = alert_id and advice is not null and action is null)
      or (kind = 'action' and id <> alert_id and advice is null and air_grade is null and action is not null
          and action in ('창문 열었어요', '공기청정기 켰어요')))
);

create index if not exists alert_logs_by_time on public.alert_logs (event_at, id);
create unique index if not exists alert_logs_one_action on public.alert_logs (alert_id) where kind = 'action';
create index if not exists sensor_logs_by_time on public.sensor_logs (measured_at);

create or replace function public.check_classroom_action() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'action' and not exists (
    select 1 from public.alert_logs a
    where a.id = new.alert_id and a.kind = 'alert' and a.session_id = new.session_id
      and new.event_at between a.event_at and a.event_at + interval '10 minutes'
  ) then
    raise exception 'Action must reference an alert in the same session within 10 minutes';
  end if;
  return new;
end;
$$;

create or replace trigger classroom_action_window before insert on public.alert_logs
  for each row execute function public.check_classroom_action();

alter table public.sensor_logs enable row level security;
alter table public.alert_logs enable row level security;
revoke all on public.sensor_logs, public.alert_logs from public, anon, authenticated, service_role;
grant select, insert on public.sensor_logs, public.alert_logs to service_role;
