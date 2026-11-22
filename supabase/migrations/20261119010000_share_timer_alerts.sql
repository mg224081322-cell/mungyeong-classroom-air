begin;

-- Extend alert events in place; measurement rows remain sensor-only.
alter table public.alert_logs drop constraint if exists alert_logs_source_check;
alter table public.alert_logs add constraint alert_logs_source_check check (source in ('serial', 'timer'));
create index if not exists alert_logs_by_source_time on public.alert_logs (source, event_at, id);

create or replace function public.check_classroom_action() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'action' and not exists (
    select 1 from public.alert_logs a
    where a.id = new.alert_id and a.kind = 'alert' and a.session_id = new.session_id
      and a.source = new.source
      and new.event_at between a.event_at and a.event_at + interval '10 minutes'
  ) then
    raise exception 'Action must reference an alert in the same source and session within 10 minutes';
  end if;
  return new;
end;
$$;

alter table public.alert_logs enable row level security;
revoke all on public.alert_logs from public, anon, authenticated, service_role;
grant select, insert on public.alert_logs to service_role;

commit;
