-- Favorites, client withdraw of a submitted choice, and "time to choose" only on first opening.
create table public.selection_favorites (
  option_id uuid not null references public.selection_options(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, user_id)
);
create index on public.selection_favorites (project_id);
create index on public.selection_favorites (user_id);
alter table public.selection_favorites enable row level security;
create policy "favorites: view" on public.selection_favorites for select to authenticated using (public.can_view_project(project_id));
create policy "favorites: add own" on public.selection_favorites for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_view_project(project_id)
    and exists (select 1 from public.selection_options o where o.id = option_id and o.project_id = selection_favorites.project_id));
create policy "favorites: remove own" on public.selection_favorites for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.withdraw_selection(sid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.selections;
begin
  select * into s from public.selections where id = sid;
  if s.id is null or not public.can_view_project(s.project_id) then raise exception 'Selection not found'; end if;
  if s.status <> 'submitted' then raise exception 'This selection has already been confirmed. Please message the Design Center to change it.'; end if;
  update public.selections set status = 'open', chosen_option_id = null, submitted_by = null, submitted_at = null where id = sid;
  insert into public.activity (project_id, actor_id, body, view) values (s.project_id, auth.uid(), 'reopened a selection: ' || s.category, 'selections');
end $$;
revoke execute on function public.withdraw_selection(uuid) from public, anon;
grant execute on function public.withdraw_selection(uuid) to authenticated;

create or replace function public.selections_opened_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'open' and new.opened_at is null then
    new.opened_at := now();
  end if;
  return new;
end $$;
