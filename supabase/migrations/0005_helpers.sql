create or replace function is_project_member(_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from project_members
    where project_id = _project_id
      and user_id    = auth.uid()
  );
$$;

revoke all on function is_project_member(uuid) from public;
grant execute on function is_project_member(uuid) to authenticated;
