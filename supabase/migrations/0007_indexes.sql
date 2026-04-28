create index threads_project_path_idx
  on threads (project_id, url_path)
  where resolved = false;

create index comments_thread_idx
  on comments (thread_id, created_at);
