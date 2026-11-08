-- Demo homes that never go stale.
-- A project with demo_anchor set is a demo: every date in it is shifted forward each night so the home
-- always looks the way it did on the anchor day (mid-build, nothing overdue that wasn't then).
-- Real homes (demo_anchor null) are never touched.
alter table public.projects add column demo_anchor date;

create or replace function public.refresh_demo() returns table (project text, days int)
language plpgsql security definer set search_path = '' as $$
declare
  p record; t record; delta int; sets text;
  today date := (now() at time zone 'America/New_York')::date;
begin
  for p in select id, name, demo_anchor from public.projects where demo_anchor is not null and demo_anchor < today loop
    delta := today - p.demo_anchor;
    -- every date / timestamp column in every table that belongs to a home (except the email log and "last seen")
    for t in
      select c.table_name, string_agg(format('%I = %I + %s', c.column_name, c.column_name,
               case when c.data_type = 'date' then delta::text else format('interval ''%s days''', delta) end), ', ') as cols
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.data_type in ('date', 'timestamp with time zone')
        and c.table_name not in ('notifications', 'project_members', 'projects', 'builders', 'profiles')
        and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.table_name and k.column_name = 'project_id')
      group by c.table_name
    loop
      if t.table_name = 'warranty_requests' then
        -- its trigger re-stamps scheduled_at when the visit date changes, so put it back afterwards
        create temp table if not exists _w (id uuid, s timestamptz) on commit drop;
        delete from _w;
        insert into _w select id, scheduled_at + make_interval(days => delta) from public.warranty_requests where project_id = p.id;
        execute format('update public.%I set %s where project_id = $1', t.table_name, t.cols) using p.id;
        update public.warranty_requests w set scheduled_at = _w.s from _w where w.id = _w.id;
      else
        execute format('update public.%I set %s where project_id = $1', t.table_name, t.cols) using p.id;
      end if;
    end loop;
    update public.projects set start_date = start_date + delta, closing_date = closing_date + delta,
      pm_note_at = pm_note_at + make_interval(days => delta), created_at = created_at + make_interval(days => delta),
      demo_anchor = today where id = p.id;
    project := p.name; days := delta; return next;
  end loop;
end $$;
revoke execute on function public.refresh_demo() from public, anon, authenticated;

-- Stoneledge demo homes were last set up on Oct 29, 2026
update public.projects set demo_anchor = '2026-10-29' where name in ('The Morgan Residence', 'The Whitfield Residence');

-- Every night at 4:05 a.m. Eastern (09:05 UTC)
select cron.schedule('portal-demo-refresh', '5 9 * * *', $$select public.refresh_demo()$$);
