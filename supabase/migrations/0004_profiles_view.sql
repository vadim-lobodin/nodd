create or replace view profiles as
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)) as display_name,
  u.raw_user_meta_data ->> 'avatar_url' as avatar_url
from auth.users u;

grant select on profiles to authenticated;
