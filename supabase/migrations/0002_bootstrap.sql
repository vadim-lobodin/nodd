-- Onboarding helpers used by AlignProvider:
--   * align_bootstrap_project — admin self-setup (claim project + admin membership)
--   * align_join_project      — open-membership join (any auth user becomes a member)
-- Both are idempotent and SECURITY DEFINER.

create or replace function align_bootstrap_project(
  _project_id      uuid,
  _project_name    text,
  _expected_email  text
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
    raise exception 'align_bootstrap_project: not authenticated';
  end if;

  select email into caller_email from auth.users where id = auth.uid();
  if caller_email is distinct from _expected_email then
    raise exception 'align_bootstrap_project: caller email does not match expected admin';
  end if;

  insert into projects (id, name)
  values (_project_id, _project_name)
  on conflict (id) do nothing;

  insert into project_members (project_id, user_id, role)
  values (_project_id, auth.uid(), 'admin')
  on conflict (project_id, user_id) do nothing;
end;
$$;

revoke all on function align_bootstrap_project(uuid, text, text) from public;
grant execute on function align_bootstrap_project(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------
-- Open-membership join: any authenticated user becomes a member of
-- an existing project. The project must already exist (created by
-- the admin via align_bootstrap_project). Idempotent.
--
-- The consumer opts into this flow by passing `openMembership` to
-- AlignProvider. Without that flag, the client never calls this RPC
-- and admins must add members via SQL (or a future invite-link UI).
-- ----------------------------------------------------------------

create or replace function align_join_project(_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'align_join_project: not authenticated';
  end if;

  if not exists (select 1 from projects where id = _project_id) then
    raise exception 'align_join_project: project does not exist';
  end if;

  insert into project_members (project_id, user_id, role)
  values (_project_id, auth.uid(), 'member')
  on conflict (project_id, user_id) do nothing;
end;
$$;

revoke all on function align_join_project(uuid) from public;
grant execute on function align_join_project(uuid) to authenticated;
