import { SupabaseClient } from '@supabase/supabase-js';

export type ProfileData = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

const profileCache = new Map<string, ProfileData>();

export async function fetchProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileData | null> {
  const cached = profileCache.get(userId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, avatar_url')
    .eq('id', userId)
    .single();

  if (error || !data) return null;

  const profile = data as ProfileData;
  profileCache.set(userId, profile);
  return profile;
}

export function clearProfileCache(): void {
  profileCache.clear();
}
