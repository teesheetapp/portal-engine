-- Remember who has seen the welcome tour (works across devices).
alter table public.profiles add column welcomed_at timestamptz;
grant update (welcomed_at) on public.profiles to authenticated;
