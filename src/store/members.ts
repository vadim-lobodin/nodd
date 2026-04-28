import { SupabaseClient } from '@supabase/supabase-js';
import type { MemberProfile, MemberCache, UserId } from './types';

export async function fetchMembers(
  supabase: SupabaseClient,
  projectId: string,
): Promise<MemberCache> {
  const { data, error } = await supabase
    .from('project_members')
    .select('user_id, role, profile:profiles(id, email, display_name, avatar_url)')
    .eq('project_id', projectId);

  if (error) throw error;

  const byId = new Map<UserId, MemberProfile>();
  const list: MemberProfile[] = [];

  for (const row of data ?? []) {
    const profile = (row as any).profile;
    const member: MemberProfile = {
      userId: row.user_id,
      role: row.role as 'member' | 'admin',
      email: profile?.email ?? '',
      displayName: profile?.display_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
    };
    byId.set(member.userId, member);
    list.push(member);
  }

  list.sort((a, b) => (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email));

  return { byId, list, fetchedAt: Date.now() };
}
