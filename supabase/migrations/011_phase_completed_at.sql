-- When each phase was completed, so a "moment" can be shared and celebrated for a few weeks after.
alter table public.phases add column completed_at timestamptz;
update public.phases set completed_at = coalesce(end_date::timestamptz, now()) where status = 'done';
create or replace function public.phases_completed_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then new.completed_at := coalesce(new.completed_at, now()); end if;
  if new.status <> 'done' then new.completed_at := null; end if;
  return new;
end $$;
create trigger phases_completed_at before insert or update of status on public.phases
  for each row execute function public.phases_completed_at();
revoke execute on function public.phases_completed_at() from public, anon, authenticated;
