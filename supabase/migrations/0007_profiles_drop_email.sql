-- ============================================================
-- 0007 — harden the `profiles` view
--
-- Two changes, both prompted by the Supabase `auth_users_exposed`
-- advisor firing on `public.profiles`:
--
-- 1. Drop the `email` column. It was only ever a display fallback for a
--    null `display_name`, and `display_name` already falls back to the
--    local-part of the address — computed here, server-side, so the full
--    address never crosses the API boundary. Nothing sensitive is left
--    behind the view.
--
-- 2. Make the owner-run filter explicit and non-bypassable. The view is
--    NOT `security_invoker` (it can't be — `authenticated` has no grant on
--    `auth.users`), so it executes as the owner and the `auth.uid()`
--    predicate below is the ONLY thing scoping rows to the caller.
--    `security_barrier` stops the planner from pushing a user-supplied
--    leaky function beneath that predicate to probe filtered-out rows.
--
-- `create or replace view` cannot drop a column, so this is a
-- drop + recreate. No RLS policy references `profiles`, so nothing
-- depends on it; grants are re-applied below because DROP discards them.
-- ============================================================

drop view if exists public.profiles;

create view public.profiles
with (security_barrier = true)
as
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)) as display_name,
  u.raw_user_meta_data ->> 'avatar_url' as avatar_url
from auth.users u
-- SECURITY-CRITICAL: this view runs as its owner and therefore bypasses RLS
-- on project_members. This predicate is the sole access control. Widening or
-- removing it turns the view into a full dump of every user in the project.
where u.id in (
  select pm.user_id
  from project_members pm
  where pm.project_id in (
    select pm2.project_id
    from project_members pm2
    where pm2.user_id = auth.uid()
  )
);

comment on view public.profiles is
  'Display identity (id, display_name, avatar_url) for users who share a '
  'project with the caller. Owner-run: the auth.uid() predicate in the view '
  'body is the only access control — see 0007. Never grant to anon; '
  'logged-out readers use the nodd_public_members RPC (0004).';

-- Supabase ships `alter default privileges in schema public grant all on tables
-- to anon, authenticated, service_role`, so CREATE VIEW silently hands anon
-- (and authenticated) arwdDxt. `revoke from public` does NOT undo a role-level
-- grant — the roles must be named. Revoke first, then grant back only SELECT,
-- and only to authenticated. Anon reads author identity via
-- nodd_public_members (0004), never through this view.
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
