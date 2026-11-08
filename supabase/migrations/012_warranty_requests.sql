-- Warranty requests after move-in: the homeowner reports something, the team schedules and resolves it.
create table public.warranty_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  number int not null default 0,
  room text,
  home_item_id uuid references public.home_items(id) on delete set null,
  title text not null,
  details text,
  urgency text not null default 'routine' check (urgency in ('urgent','routine')),
  photos text[] not null default '{}',
  status text not null default 'new' check (status in ('new','scheduled','resolved','not_covered')),
  scheduled_for date,
  scheduled_window text,
  scheduled_at timestamptz,
  response text,                       -- the team's note to the homeowner
  resolved_at timestamptz,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);
create index on public.warranty_requests (project_id, created_at desc);
create index on public.warranty_requests (home_item_id);
create index on public.warranty_requests (created_by);
alter table public.warranty_requests enable row level security;

create policy "warranty: view" on public.warranty_requests for select to authenticated using (public.can_view_project(project_id));
-- Homeowners can open a request on their own home; only the team can schedule, answer or close it.
create policy "warranty: client opens" on public.warranty_requests for insert to authenticated
  with check (public.can_view_project(project_id) and (public.is_project_staff(project_id) or (status = 'new' and created_by = auth.uid() and scheduled_for is null and response is null and resolved_at is null)));
create policy "warranty: staff update" on public.warranty_requests for update to authenticated using (public.is_project_staff(project_id)) with check (public.is_project_staff(project_id));
create policy "warranty: staff delete" on public.warranty_requests for delete to authenticated using (public.is_project_staff(project_id));

-- Number each request per home (W-01, W-02…) and stamp status changes
create or replace function public.warranty_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('warranty:' || new.project_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.warranty_requests where project_id = new.project_id;
    new.created_at := now();
  end if;
  if new.status = 'scheduled' and (tg_op = 'INSERT' or old.status is distinct from 'scheduled' or old.scheduled_for is distinct from new.scheduled_for) then new.scheduled_at := now(); end if;
  if new.status in ('resolved','not_covered') and (tg_op = 'INSERT' or old.status is distinct from new.status) then new.resolved_at := now(); end if;
  if new.status in ('new','scheduled') then new.resolved_at := null; end if;
  return new;
end $$;
create trigger warranty_stamp before insert or update on public.warranty_requests for each row execute function public.warranty_stamp();
revoke execute on function public.warranty_stamp() from public, anon, authenticated;

-- Homeowners may add photos to a warranty request (only under <home>/warranty/)
create policy "files: client warranty photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and (storage.foldername(name))[2] = 'warranty' and public.can_view_project(public.path_project(name)));
