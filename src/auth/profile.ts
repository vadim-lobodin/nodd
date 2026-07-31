import { SupabaseClient } from '@supabase/supabase-js';

// Mirrors the `profiles` view. No `email`: 0007 dropped that column, and
// selecting it answers 400 `column profiles.email does not exist`. The
// caller's own address comes from the session instead.
export type ProfileData = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

const MAX_PROFILE_CACHE = 500;
const profileCache = new Map<string, ProfileData>();

export async function fetchProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileData | null> {
  const cached = profileCache.get(userId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('id', userId)
    .single();

  if (error || !data) return null;

  const profile = data as ProfileData;
  // Bound the cache: evict oldest insertion (Map preserves insertion order)
  // when at capacity, so a long-lived session can't grow it unbounded.
  if (profileCache.size >= MAX_PROFILE_CACHE) {
    const oldest = profileCache.keys().next().value;
    if (oldest !== undefined) profileCache.delete(oldest);
  }
  profileCache.set(userId, profile);
  return profile;
}

export function clearProfileCache(): void {
  profileCache.clear();
}
