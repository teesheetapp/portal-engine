-- Applied after 001: indexes on every foreign key, and helper functions closed to signed-out visitors.
create index if not exists projects_pm_id_idx on public.projects (pm_id);
create index if not exists updates_phase_id_idx on public.updates (phase_id);
create index if not exists updates_author_id_idx on public.updates (author_id);
create index if not exists update_comments_author_id_idx on public.update_comments (author_id);
create index if not exists update_thanks_user_id_idx on public.update_thanks (user_id);
create index if not exists questions_phase_id_idx on public.questions (phase_id);
create index if not exists questions_asked_by_idx on public.questions (asked_by);
create index if not exists questions_answered_by_idx on public.questions (answered_by);
create index if not exists selections_submitted_by_idx on public.selections (submitted_by);
create index if not exists selections_chosen_option_id_idx on public.selections (chosen_option_id);
create index if not exists change_orders_created_by_idx on public.change_orders (created_by);
create index if not exists change_orders_signed_by_idx on public.change_orders (signed_by);
create index if not exists events_requested_by_idx on public.events (requested_by);
create index if not exists documents_uploaded_by_idx on public.documents (uploaded_by);
create index if not exists notes_author_id_idx on public.notes (author_id);
create index if not exists notes_reviewed_by_idx on public.notes (reviewed_by);
create index if not exists messages_author_id_idx on public.messages (author_id);
create index if not exists activity_actor_id_idx on public.activity (actor_id);

revoke execute on function public.my_builder_id(), public.is_builder_staff(uuid), public.is_builder_admin(uuid),
  public.is_project_staff(uuid), public.can_view_project(uuid), public.shares_project(uuid), public.path_project(text)
  from public, anon;
grant execute on function public.my_builder_id(), public.is_builder_staff(uuid), public.is_builder_admin(uuid),
  public.is_project_staff(uuid), public.can_view_project(uuid), public.shares_project(uuid), public.path_project(text)
  to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
