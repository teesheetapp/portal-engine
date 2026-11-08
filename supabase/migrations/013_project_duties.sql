-- Who handles what on each home (selections, home manual, wall photos, visits, notes, warranty, draws).
-- Keys are areas, values are team member ids. Anything not assigned goes to the project manager.
alter table public.projects add column duties jsonb not null default '{}'::jsonb;
