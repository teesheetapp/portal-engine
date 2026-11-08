-- "Behind the walls": room-by-room photos taken before insulation, tagged by surface and system.
create table public.wall_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  room text not null,
  surface text,
  systems text[] not null default '{}',
  path text not null,
  caption text,
  taken_on date not null default current_date,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.wall_photos (project_id, room);
create index on public.wall_photos (uploaded_by);
alter table public.wall_photos enable row level security;
create policy "wall_photos: view" on public.wall_photos for select to authenticated using (public.can_view_project(project_id));
create policy "wall_photos: staff write" on public.wall_photos for all to authenticated using (public.is_project_staff(project_id)) with check (public.is_project_staff(project_id));
