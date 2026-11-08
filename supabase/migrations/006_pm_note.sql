-- A short personal note from the project manager, shown at the top of the home's overview.
alter table public.projects add column pm_note text, add column pm_note_at timestamptz, add column pm_note_by uuid references public.profiles(id) on delete set null;
create index on public.projects (pm_note_by);
