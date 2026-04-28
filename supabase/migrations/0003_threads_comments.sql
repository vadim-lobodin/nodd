create table threads (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  url_path     text not null,
  pin          jsonb not null,
  resolved     boolean not null default false,
  resolved_by  uuid references auth.users(id),
  resolved_at  timestamptz,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now()
);
alter table threads enable row level security;

create table comments (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references threads(id) on delete cascade,
  author_id   uuid not null references auth.users(id),
  body        text not null,
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
alter table comments enable row level security;
