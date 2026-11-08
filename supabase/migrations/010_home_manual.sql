-- Home manual: every finish, fixture, appliance and system in the house, room by room.
-- Rows can come from a finished selection (selection_id) or be added by the team.
-- room 'Whole home' holds the essentials (shut-offs, panel, filters, equipment).
create table public.home_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  room text not null,
  category text not null default 'Other',
  name text not null,                 -- what it is: "Walls", "Main water shut-off", "Range"
  maker text,                         -- brand / manufacturer
  product text,                       -- color, model, style
  detail text,                        -- finish, sheen, size, serial number, location
  care text,                          -- how to care for it
  warranty_until date,
  document_id uuid references public.documents(id) on delete set null,   -- manual / spec sheet
  photo_path text,
  selection_id uuid references public.selections(id) on delete set null,
  position int not null default 0,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.home_items (project_id, room);
create index on public.home_items (document_id);
create index on public.home_items (selection_id);
create index on public.home_items (created_by);
alter table public.home_items enable row level security;
create policy "home_items: view" on public.home_items for select to authenticated using (public.can_view_project(project_id));
create policy "home_items: staff write" on public.home_items for all to authenticated using (public.is_project_staff(project_id)) with check (public.is_project_staff(project_id));
