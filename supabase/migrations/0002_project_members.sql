create type project_role as enum ('member', 'admin');

create table project_members (
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        project_role not null default 'member',
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
alter table project_members enable row level security;
