-- Keep pg_net out of the public schema (Supabase security advisor).
drop extension if exists pg_net;
create extension pg_net schema extensions;
