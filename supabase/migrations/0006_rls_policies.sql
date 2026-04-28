-- projects
create policy projects_select_member on projects
  for select using (is_project_member(id));

-- project_members
create policy members_select_member on project_members
  for select using (is_project_member(project_id));

-- threads
create policy threads_select_member on threads
  for select using (is_project_member(project_id));

create policy threads_insert_member on threads
  for insert with check (
    is_project_member(project_id) and created_by = auth.uid()
  );

create policy threads_update_resolve on threads
  for update using (is_project_member(project_id))
  with check    (is_project_member(project_id));

create policy threads_delete_author on threads
  for delete using (is_project_member(project_id) and created_by = auth.uid());

-- comments
create policy comments_select_member on comments
  for select using (
    exists (
      select 1 from threads t
      where t.id = comments.thread_id
        and is_project_member(t.project_id)
    )
  );

create policy comments_insert_member on comments
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from threads t
      where t.id = comments.thread_id
        and is_project_member(t.project_id)
    )
  );

create policy comments_update_author on comments
  for update using (author_id = auth.uid())
  with check    (author_id = auth.uid());

create policy comments_delete_author on comments
  for delete using (author_id = auth.uid());
