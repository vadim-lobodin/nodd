-- Prototype scoping (Nodd Phase 2, foundation).
--
-- A thread already knows the screen it lives on (url_path). prototype_id records
-- which *prototype* that screen belongs to, so the sidebar can offer a single
-- inbox spanning every screen of a prototype. It is intentionally nullable and
-- additive: pre-existing threads keep prototype_id = null and simply never
-- appear in the per-prototype view. Membership/public-read RLS on threads is
-- unchanged — the inbox query just adds `prototype_id = $1` under the existing
-- project-scoped policies, so no new policy is required.

alter table threads add column if not exists prototype_id text;

-- Serves the inbox query: threads for one prototype across all its screens,
-- open-only (the sidebar's resolved view is a bounded, separate fetch).
create index if not exists threads_project_prototype_idx
  on threads (project_id, prototype_id)
  where resolved = false;

-- Extend the atomic creator with an optional prototype id. `create or replace`
-- with a new trailing default keeps older clients (which omit it) working, and
-- the previous 8-arg signature is dropped so the grant/revoke below apply to the
-- single current definition.
drop function if exists nodd_create_thread(uuid, uuid, uuid, text, jsonb, text, text, uuid[]);

create or replace function nodd_create_thread(
  _thread_id uuid,
  _comment_id uuid,
  _project_id uuid,
  _url_path text,
  _pin jsonb,
  _state_key text,
  _body text,
  _mentions uuid[] default '{}',
  _prototype_id text default null
)
returns table (thread_id uuid, comment_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into threads (
    id,
    project_id,
    url_path,
    pin,
    state_key,
    created_by,
    prototype_id
  ) values (
    _thread_id,
    _project_id,
    _url_path,
    _pin,
    coalesce(_state_key, ''),
    auth.uid(),
    _prototype_id
  );

  insert into comments (
    id,
    thread_id,
    author_id,
    body,
    mentions
  ) values (
    _comment_id,
    _thread_id,
    auth.uid(),
    _body,
    coalesce(_mentions, '{}')
  );

  return query select _thread_id, _comment_id;
end;
$$;

revoke all on function nodd_create_thread(uuid, uuid, uuid, text, jsonb, text, text, uuid[], text) from public;
grant execute on function nodd_create_thread(uuid, uuid, uuid, text, jsonb, text, text, uuid[], text) to authenticated;
