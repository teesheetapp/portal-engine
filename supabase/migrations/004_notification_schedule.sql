-- Scheduler for email notifications (see functions/notify).
create extension if not exists pg_cron;
create extension if not exists pg_net schema extensions;

create or replace function public.run_notify(mode text) returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://nsftiohfzboovyyzijbu.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')),
    body := jsonb_build_object('mode', mode),
    timeout_milliseconds := 60000)
$$;
revoke execute on function public.run_notify(text) from public, anon, authenticated;

-- Times are UTC. 13:30 UTC = 9:30 AM Eastern (8:30 in winter); Friday 20:00 UTC = 4 PM Eastern (3 PM in winter).
select cron.schedule('portal-notify-instant', '*/5 * * * *', $$select public.run_notify('instant')$$);
select cron.schedule('portal-notify-reminders', '30 13 * * *', $$select public.run_notify('reminders')$$);
select cron.schedule('portal-notify-digest', '0 20 * * 5', $$select public.run_notify('digest')$$);
