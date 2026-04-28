-- Seed data for local development only (applied via `supabase db reset`)
-- Requires two test users to exist in auth.users (created by Supabase local dev)

insert into projects (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Acme Demo');

-- Note: project_members and sample threads require auth.users rows.
-- After running `supabase db reset`, create test users via the Auth UI,
-- then insert membership rows manually:
--
-- insert into project_members (project_id, user_id, role) values
--   ('00000000-0000-0000-0000-000000000001', '<user-uuid>', 'admin');
