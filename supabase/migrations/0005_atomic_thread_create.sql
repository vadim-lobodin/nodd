-- Create a thread and its root comment in one transaction. The function runs
-- as the caller, so the existing threads/comments RLS policies remain the
-- authorization boundary.

create or replace function nodd_create_thread(
  _thread_id uuid,
  _comment_id uuid,
  _project_id uuid,
  _url_path text,
  _pin jsonb,
  _state_key text,
  _body text,
  _mentions uuid[] default '{}'
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
    created_by
  ) values (
    _thread_id,
    _project_id,
    _url_path,
    _pin,
    coalesce(_state_key, ''),
    auth.uid()
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

revoke all on function nodd_create_thread(uuid, uuid, uuid, text, jsonb, text, text, uuid[]) from public;
grant execute on function nodd_create_thread(uuid, uuid, uuid, text, jsonb, text, text, uuid[]) to authenticated;
