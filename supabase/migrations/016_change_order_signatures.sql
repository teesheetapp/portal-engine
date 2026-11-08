-- Change orders that hold up: a full electronic-signature record, a fingerprint of exactly what was signed,
-- numbers assigned by the database, and no editing or deleting once signed.
alter table public.change_orders
  add column signer_name text,          -- full name as typed by the signer
  add column sign_audit jsonb,          -- email, device, network address, consent wording, time zone
  add column content_hash text;         -- SHA-256 of the terms as signed

-- What the terms are, as one string (used for the fingerprint)
create or replace function public.change_order_terms(c public.change_orders) returns text
language sql immutable set search_path = '' as $$
  select concat_ws('|', 'CO-' || c.number, c.title, coalesce(c.details, ''), c.amount::text, coalesce(c.days, 0)::text)
$$;

-- Fingerprint the change orders that were signed before this existed
update public.change_orders c set content_hash = encode(extensions.digest(public.change_order_terms(c), 'sha256'), 'hex')
  where status = 'approved' and content_hash is null;

-- Numbers come from the database (two change orders sent at once can't collide), and signed ones are locked
create or replace function public.change_orders_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('co:' || new.project_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.change_orders where project_id = new.project_id;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'pending' then raise exception 'A signed or declined change order is part of the record and can''t be deleted'; end if;
    return old;
  end if;
  -- the nightly demo refresh may move dates on demo homes
  if current_setting('portal.demo_refresh', true) = 'on' then return new; end if;
  if old.status <> 'pending' and (new.title, new.details, new.amount, new.days, new.number, new.signature, new.signed_by, new.signed_at, new.signer_name, new.sign_audit, new.content_hash)
     is distinct from (old.title, old.details, old.amount, old.days, old.number, old.signature, old.signed_by, old.signed_at, old.signer_name, old.sign_audit, old.content_hash) then
    raise exception 'This change order has been %, so its terms can''t be changed. Send a new change order instead.', old.status;
  end if;
  return new;
end $$;
create trigger change_orders_guard before insert or update or delete on public.change_orders for each row execute function public.change_orders_guard();
revoke execute on function public.change_orders_guard() from public, anon, authenticated;

-- Signing: the client's typed full name, initials, and explicit consent to sign electronically are required
drop function if exists public.sign_change_order(uuid, text);
create or replace function public.sign_change_order(cid uuid, initials text, full_name text, consent boolean, tz text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.change_orders; h json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
begin
  select * into c from public.change_orders where id = cid;
  if c.id is null or not public.can_view_project(c.project_id) then raise exception 'Change order not found'; end if;
  if c.status <> 'pending' then raise exception 'This change order is no longer pending'; end if;
  if coalesce(trim(initials), '') = '' then raise exception 'Initials are required'; end if;
  if coalesce(trim(full_name), '') = '' then raise exception 'Please type your full name'; end if;
  if consent is not true then raise exception 'Please agree to sign electronically'; end if;
  update public.change_orders set status = 'approved', signature = upper(trim(initials)), signer_name = trim(full_name),
    signed_by = auth.uid(), signed_at = now(),
    content_hash = encode(extensions.digest(public.change_order_terms(c), 'sha256'), 'hex'),
    sign_audit = jsonb_build_object(
      'email', auth.jwt() ->> 'email',
      'ip', split_part(coalesce(h ->> 'x-forwarded-for', h ->> 'x-real-ip', ''), ',', 1),
      'device', left(coalesce(h ->> 'user-agent', ''), 300),
      'time_zone', tz,
      'consent', 'I agree to sign this change order electronically. My electronic signature has the same effect as my handwritten signature.')
  where id = cid;
  insert into public.activity (project_id, actor_id, body, view) values (c.project_id, auth.uid(), 'signed change order ' || c.number, 'changes');
end $$;
revoke execute on function public.sign_change_order(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.sign_change_order(uuid, text, text, boolean, text) to authenticated;


-- Let the demo refresh shift dates on signed change orders
create or replace function public.refresh_demo() returns table (project text, days int)
language plpgsql security definer set search_path = '' as $$
declare
  p record; t record; delta int;
  today date := (now() at time zone 'America/New_York')::date;
begin
  perform set_config('portal.demo_refresh', 'on', true);
  for p in select id, name, demo_anchor from public.projects where demo_anchor is not null and demo_anchor < today loop
    delta := today - p.demo_anchor;
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
  perform set_config('portal.demo_refresh', 'off', true);
end $$;
revoke execute on function public.refresh_demo() from public, anon, authenticated;
revoke execute on function public.change_order_terms(public.change_orders) from public, anon, authenticated;
