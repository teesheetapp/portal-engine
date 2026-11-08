-- Builder client portal: multi-builder schema
-- Every builder's data is isolated by row-level security.
-- Staff (admin/staff) see every home of their own builder; clients see only homes they are members of.

create extension if not exists pgcrypto;

-- ============ core ============
create table public.builders (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  builder_id uuid references public.builders(id) on delete set null,
  role text not null default 'client' check (role in ('admin','staff','client')),
  full_name text,
  title text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);
create index on public.profiles (builder_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders(id) on delete cascade,
  name text not null,
  client_names text,
  address text,
  lot text,
  summary text,
  start_date date,
  closing_date date,
  contract_amount numeric(14,2) not null default 0,
  permit text,
  site_access text,
  pm_id uuid references public.profiles(id) on delete set null,
  cover_path text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.projects (builder_id);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index on public.project_members (user_id);

-- ============ project content ============
create table public.phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position int not null,
  name text not null,
  start_date date,
  end_date date,
  status text not null default 'upcoming' check (status in ('done','current','upcoming')),
  what text, look text, decisions text
);
create index on public.phases (project_id);

create table public.updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  author_id uuid references public.profiles(id) on delete set null,
  body text,
  created_at timestamptz not null default now()
);
create index on public.updates (project_id, created_at desc);

create table public.update_photos (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.updates(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null,
  caption text,
  position int not null default 0
);
create index on public.update_photos (update_id);
create index on public.update_photos (project_id);

create table public.update_comments (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.updates(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index on public.update_comments (update_id);
create index on public.update_comments (project_id);

create table public.update_thanks (
  update_id uuid not null references public.updates(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  primary key (update_id, user_id)
);
create index on public.update_thanks (project_id);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  asked_by uuid references public.profiles(id) on delete set null,
  question text not null,
  why text,
  options text[] not null default '{}',
  due_date date,
  status text not null default 'open' check (status in ('open','answered')),
  answer text,
  answered_by uuid references public.profiles(id) on delete set null,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.questions (project_id);

create table public.selections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null,
  area text,
  due_date date,
  allowance numeric(14,2) not null default 0,
  status text not null default 'open' check (status in ('later','open','submitted','approved')),
  chosen_option_id uuid,
  note text,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.selections (project_id);

create table public.selection_options (
  id uuid primary key default gen_random_uuid(),
  selection_id uuid not null references public.selections(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  detail text,
  price numeric(14,2) not null default 0,
  swatches text[] not null default '{}',
  image_path text,
  position int not null default 0
);
create index on public.selection_options (selection_id);
create index on public.selection_options (project_id);
alter table public.selections add constraint selections_chosen_fk
  foreign key (chosen_option_id) references public.selection_options(id) on delete set null;

create table public.change_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  number int not null,
  title text not null,
  details text,
  amount numeric(14,2) not null default 0,
  days int not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  signed_by uuid references public.profiles(id) on delete set null,
  signature text,
  signed_at timestamptz,
  decline_note text
);
create index on public.change_orders (project_id);

create table public.draws (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position int not null,
  name text not null,
  percent numeric(6,3) not null default 0,
  status text not null default 'scheduled' check (status in ('paid','next','scheduled')),
  due_date date,
  paid_date date
);
create index on public.draws (project_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  starts_on date not null,
  time_label text,
  title text not null,
  kind text not null default 'Visit',
  location text,
  note text,
  is_key boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled','requested','done')),
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.events (project_id, starts_on);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  folder text not null default 'General',
  name text not null,
  path text not null,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.documents (project_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  room text,
  body text not null,
  reviewed boolean not null default false,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.notes (project_id);

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  position int not null default 0
);
create index on public.threads (project_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index on public.messages (thread_id, created_at);
create index on public.messages (project_id);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid default auth.uid() references public.profiles(id) on delete set null,
  body text not null,
  view text,
  created_at timestamptz not null default now()
);
create index on public.activity (project_id, created_at desc);

-- ============ access helpers ============
create or replace function public.my_builder_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select builder_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_builder_staff(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.builder_id = b and p.role in ('admin','staff'))
$$;

create or replace function public.is_builder_admin(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.builder_id = b and p.role = 'admin')
$$;

create or replace function public.is_project_staff(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects pr
    join public.profiles p on p.builder_id = pr.builder_id
    where pr.id = pid and p.id = auth.uid() and p.role in ('admin','staff'))
$$;

create or replace function public.can_view_project(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_project_staff(pid)
      or exists (select 1 from public.project_members m where m.project_id = pid and m.user_id = auth.uid())
$$;

create or replace function public.shares_project(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members a
    join public.project_members b on a.project_id = b.project_id
    where a.user_id = auth.uid() and b.user_id = other)
$$;

create or replace function public.path_project(object_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

-- ============ row-level security ============
alter table public.builders enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;

create policy "builders: members read own builder" on public.builders
  for select to authenticated using (id = (select public.my_builder_id()));
create policy "builders: admin updates" on public.builders
  for update to authenticated using (public.is_builder_admin(id)) with check (public.is_builder_admin(id));

create policy "profiles: read self, own builder team, co-members" on public.profiles
  for select to authenticated using (
    id = (select auth.uid())
    or public.is_builder_staff(builder_id)
    or (role in ('admin','staff') and builder_id = (select public.my_builder_id()))
    or public.shares_project(id)
  );
create policy "profiles: update self" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles: admin manages team" on public.profiles
  for update to authenticated using (public.is_builder_admin(builder_id)) with check (public.is_builder_admin(builder_id));
-- users may only change their own contact fields; role and builder are set by the invite function
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone, title) on public.profiles to authenticated;

create policy "projects: view" on public.projects
  for select to authenticated using (public.can_view_project(id));
create policy "projects: staff insert" on public.projects
  for insert to authenticated with check (public.is_builder_staff(builder_id));
create policy "projects: staff update" on public.projects
  for update to authenticated using (public.is_builder_staff(builder_id)) with check (public.is_builder_staff(builder_id));
create policy "projects: admin delete" on public.projects
  for delete to authenticated using (public.is_builder_admin(builder_id));

create policy "members: view" on public.project_members
  for select to authenticated using (public.can_view_project(project_id));
create policy "members: staff manage" on public.project_members
  for all to authenticated using (public.is_project_staff(project_id)) with check (public.is_project_staff(project_id));
create policy "members: update own last seen" on public.project_members
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- every content table: members read, staff write
do $$
declare t text;
begin
  foreach t in array array['phases','updates','update_photos','update_comments','update_thanks','questions',
    'selections','selection_options','change_orders','draws','events','documents','notes','threads','messages','activity']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s: view" on public.%I for select to authenticated using (public.can_view_project(project_id))', t, t);
    execute format('create policy "%s: staff write" on public.%I for all to authenticated using (public.is_project_staff(project_id)) with check (public.is_project_staff(project_id))', t, t);
  end loop;
end $$;

-- things clients can add themselves
create policy "comments: members add own" on public.update_comments
  for insert to authenticated with check (public.can_view_project(project_id) and author_id = (select auth.uid()));
create policy "comments: delete own" on public.update_comments
  for delete to authenticated using (author_id = (select auth.uid()));
create policy "thanks: members add own" on public.update_thanks
  for insert to authenticated with check (public.can_view_project(project_id) and user_id = (select auth.uid()));
create policy "thanks: remove own" on public.update_thanks
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "messages: members add own" on public.messages
  for insert to authenticated with check (public.can_view_project(project_id) and author_id = (select auth.uid()));
create policy "notes: members add own" on public.notes
  for insert to authenticated with check (public.can_view_project(project_id) and author_id = (select auth.uid()));
create policy "notes: edit own" on public.notes
  for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "notes: delete own" on public.notes
  for delete to authenticated using (author_id = (select auth.uid()));
create policy "activity: members add own" on public.activity
  for insert to authenticated with check (public.can_view_project(project_id) and actor_id = (select auth.uid()));

-- ============ client actions (checked server-side) ============
create or replace function public.answer_question(qid uuid, answer_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.questions;
begin
  select * into q from public.questions where id = qid;
  if q.id is null or not public.can_view_project(q.project_id) then raise exception 'Question not found'; end if;
  if q.status <> 'open' then raise exception 'This question was already answered'; end if;
  if coalesce(trim(answer_text),'') = '' then raise exception 'Answer is empty'; end if;
  update public.questions set status = 'answered', answer = trim(answer_text), answered_by = auth.uid(), answered_at = now() where id = qid;
  insert into public.activity (project_id, actor_id, body, view) values (q.project_id, auth.uid(), 'answered a question', 'questions');
end $$;

create or replace function public.choose_selection(sid uuid, oid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.selections;
begin
  select * into s from public.selections where id = sid;
  if s.id is null or not public.can_view_project(s.project_id) then raise exception 'Selection not found'; end if;
  if s.status <> 'open' then raise exception 'This selection is no longer open'; end if;
  if not exists (select 1 from public.selection_options o where o.id = oid and o.selection_id = sid) then raise exception 'Option not found'; end if;
  update public.selections set chosen_option_id = oid, status = 'submitted', submitted_by = auth.uid(), submitted_at = now() where id = sid;
  insert into public.activity (project_id, actor_id, body, view) values (s.project_id, auth.uid(), 'submitted a selection: ' || s.category, 'selections');
end $$;

create or replace function public.sign_change_order(cid uuid, initials text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.change_orders;
begin
  select * into c from public.change_orders where id = cid;
  if c.id is null or not public.can_view_project(c.project_id) then raise exception 'Change order not found'; end if;
  if c.status <> 'pending' then raise exception 'This change order is no longer pending'; end if;
  if coalesce(trim(initials),'') = '' then raise exception 'Initials are required'; end if;
  update public.change_orders set status = 'approved', signature = upper(trim(initials)), signed_by = auth.uid(), signed_at = now() where id = cid;
  insert into public.activity (project_id, actor_id, body, view) values (c.project_id, auth.uid(), 'signed change order ' || c.number, 'changes');
end $$;

create or replace function public.decline_change_order(cid uuid, note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.change_orders;
begin
  select * into c from public.change_orders where id = cid;
  if c.id is null or not public.can_view_project(c.project_id) then raise exception 'Change order not found'; end if;
  if c.status <> 'pending' then raise exception 'This change order is no longer pending'; end if;
  update public.change_orders set status = 'declined', decline_note = nullif(trim(note),''), signed_by = auth.uid(), signed_at = now() where id = cid;
  insert into public.activity (project_id, actor_id, body, view) values (c.project_id, auth.uid(), 'declined change order ' || c.number, 'changes');
end $$;

create or replace function public.request_visit(pid uuid, kind text, on_date date, time_label text, note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_view_project(pid) then raise exception 'Home not found'; end if;
  insert into public.events (project_id, starts_on, time_label, title, kind, note, status, requested_by)
    values (pid, on_date, time_label, kind || ' (requested)', kind, nullif(trim(note),''), 'requested', auth.uid());
  insert into public.activity (project_id, actor_id, body, view) values (pid, auth.uid(), 'requested a ' || lower(kind), 'calendar');
end $$;

revoke execute on function public.answer_question, public.choose_selection, public.sign_change_order,
  public.decline_change_order, public.request_visit from anon, public;
grant execute on function public.answer_question, public.choose_selection, public.sign_change_order,
  public.decline_change_order, public.request_visit to authenticated;

-- ============ new users ============
-- Every new auth user gets a bare profile with no builder. The invite function assigns builder and role,
-- so someone who signs up on their own sees nothing.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ file storage ============
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 52428800)
on conflict (id) do nothing;

create policy "files: members read" on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and public.can_view_project(public.path_project(name)));
create policy "files: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and public.is_project_staff(public.path_project(name)));
create policy "files: staff update" on storage.objects for update to authenticated
  using (bucket_id = 'project-files' and public.is_project_staff(public.path_project(name)));
create policy "files: staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and public.is_project_staff(public.path_project(name)));
