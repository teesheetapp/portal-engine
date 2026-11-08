-- Email notifications: preferences, a log that also prevents duplicate sends, and the schedule.

-- Each person can turn emails off
alter table public.profiles
  add column email_updates boolean not null default true,   -- "something needs you" + replies
  add column email_digest boolean not null default true;    -- Friday "Your home this week"
grant update (email_updates, email_digest) on public.profiles to authenticated;

-- PM can choose to email clients immediately about a site update (otherwise it waits for Friday)
alter table public.updates add column notify_now boolean not null default false;

-- When a selection opened for choosing (so "time to choose" goes out once, at the right moment)
alter table public.selections add column opened_at timestamptz;
update public.selections set opened_at = created_at where status = 'open';
create or replace function public.selections_opened_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    new.opened_at := now();
  end if;
  return new;
end $$;
create trigger selections_opened_at before insert or update of status on public.selections
  for each row execute function public.selections_opened_at();

-- Every email, sent or not. The unique key means each email goes out at most once.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  kind text not null,
  ref_key text not null,
  to_email text,
  subject text,
  html text,
  status text not null default 'pending' check (status in ('pending','sent','preview','skipped','failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref_key)
);
create index on public.notifications (project_id, created_at desc);
alter table public.notifications enable row level security;
create policy "notifications: staff read" on public.notifications
  for select to authenticated using (public.is_project_staff(project_id));

-- Shared secret so only the scheduler can run the email function. Generated here, never leaves the database.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'notify_secret', 'Lets the scheduler call the notify function');
create or replace function public.check_notify_secret(s text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'notify_secret' and decrypted_secret = s)
$$;
revoke execute on function public.check_notify_secret(text) from public, anon, authenticated;
grant execute on function public.check_notify_secret(text) to service_role;
revoke execute on function public.selections_opened_at() from public, anon, authenticated;
