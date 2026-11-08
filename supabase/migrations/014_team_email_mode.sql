-- Team members can choose one morning summary instead of an email for each item (urgent warranty still immediate)
alter table public.profiles add column email_mode text not null default 'instant' check (email_mode in ('instant','daily'));
grant update (email_mode) on public.profiles to authenticated;
select cron.schedule('portal-notify-morning', '15 11 * * 1-5', $$select public.run_notify('morning')$$);
