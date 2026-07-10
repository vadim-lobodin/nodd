-- Opt-in public (logged-out) read access to a project's comments.
--
-- Off by default. A project owner sets `projects.allow_public_reads = true`
-- (via the CLI init prompt, the bootstrap RPC, or a manual UPDATE) to let the
-- anon role read that project's threads + comments. Mutations stay
-- authenticated-only — this migration grants SELECT to anon and nothing else.

alter table projects
  add column if not exists allow_public_reads boolean not null default false;

-- SECURITY DEFINER predicate, the public-reads mirror of is_project_member:
-- lets the anon SELECT policies check the flag without a direct grant on the
-- projects table (which would otherwise be gated by its own member RLS).
create or replace function is_public_project(_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select allow_public_reads from projects where id = _project_id),
    false
  );
$$;
revoke all on function is_public_project(uuid) from public;
grant execute on function is_public_project(uuid) to anon, authenticated;

-- Anon needs a table-level SELECT grant in addition to a permissive policy.
grant select on public.threads  to anon;
grant select on public.comments to anon;

-- Permissive SELECT policies for public-reads projects. These are OR-combined
-- with the existing member policies, so members are unaffected. Applied to
-- both anon and authenticated so a signed-in non-member can also read.
create policy threads_select_public on threads
  for select
  to anon, authenticated
  using (is_public_project(project_id));

create policy comments_select_public on comments
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from threads t
      where t.id = comments.thread_id
        and is_public_project(t.project_id)
    )
  );

-- Author identity for public readers. The `profiles` view exposes emails and
-- is NOT granted to anon; this SECURITY DEFINER function returns only the
-- display name + avatar (mirroring the view's display_name fallback), scoped
-- to members of a public-reads project. Email-free by design.
create or replace function nodd_public_members(_project_id uuid)
returns table (user_id uuid, display_name text, avatar_url text)
language sql
security definer
set search_path = public
stable
as $$
  select
    pm.user_id,
    coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)),
    u.raw_user_meta_data ->> 'avatar_url'
  from project_members pm
  join auth.users u on u.id = pm.user_id
  where pm.project_id = _project_id
    and is_public_project(_project_id);
$$;
revoke all on function nodd_public_members(uuid) from public;
grant execute on function nodd_public_members(uuid) to anon, authenticated;

-- ----------------------------------------------------------------
-- Extend the bootstrap RPC with an _allow_public_reads argument so the
-- provider / CLI can set the flag at project-creation time (and flip it on a
-- later admin sign-in). Forward-only: drop the 3-arg signature from 0002 and
-- recreate with the new one. The email check still gates who may call it.
-- ----------------------------------------------------------------

drop function if exists nodd_bootstrap_project(uuid, text, text);

create or replace function nodd_bootstrap_project(
  _project_id          uuid,
  _project_name        text,
  _expected_email      text,
  _allow_public_reads  boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text;
begin
  if auth.uid() is null then
    raise exception 'nodd_bootstrap_project: not authenticated';
  end if;

  select email into caller_email from auth.users where id = auth.uid();
  if caller_email is distinct from _expected_email then
    raise exception 'nodd_bootstrap_project: caller email does not match expected admin';
  end if;

  insert into projects (id, name, allow_public_reads)
  values (_project_id, _project_name, _allow_public_reads)
  on conflict (id) do update set allow_public_reads = excluded.allow_public_reads;

  insert into project_members (project_id, user_id, role)
  values (_project_id, auth.uid(), 'admin')
  on conflict (project_id, user_id) do nothing;
end;
$$;

revoke all on function nodd_bootstrap_project(uuid, text, text, boolean) from public;
grant execute on function nodd_bootstrap_project(uuid, text, text, boolean) to authenticated;
