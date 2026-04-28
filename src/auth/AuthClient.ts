import { SupabaseClient, AuthChangeEvent, Session } from '@supabase/supabase-js';
import { fetchProfile, clearProfileCache } from './profile';

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type AuthChangeCallback = (user: CurrentUser | null) => void;

export class AuthClient {
  private supabase: SupabaseClient;
  private _currentUser: CurrentUser | null = null;
  private listeners = new Set<AuthChangeCallback>();
  private unsubscribeAuth: (() => void) | null = null;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  get currentUser(): CurrentUser | null {
    return this._currentUser;
  }

  async signIn(email: string): Promise<void> {
    const { error } = await this.supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? window.location.href : undefined,
      },
    });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();
    if (error) throw error;
    this._currentUser = null;
    clearProfileCache();
    this.notify();
  }

  async restoreSession(): Promise<CurrentUser | null> {
    const { data: { session } } = await this.supabase.auth.getSession();
    if (session?.user) {
      await this.hydrateUser(session.user.id, session.user.email ?? '');
    } else {
      this._currentUser = null;
      this.notify();
    }
    return this._currentUser;
  }

  onAuthChange(callback: AuthChangeCallback): () => void {
    this.listeners.add(callback);

    // Set up Supabase auth listener on first subscriber
    if (!this.unsubscribeAuth) {
      const { data: { subscription } } = this.supabase.auth.onAuthStateChange(
        async (event: AuthChangeEvent, session: Session | null) => {
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
            if (session?.user) {
              await this.hydrateUser(session.user.id, session.user.email ?? '');
            }
          } else if (event === 'SIGNED_OUT') {
            this._currentUser = null;
            clearProfileCache();
            this.notify();
          }
        },
      );
      this.unsubscribeAuth = () => subscription.unsubscribe();
    }

    // Emit current value synchronously
    callback(this._currentUser);

    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0 && this.unsubscribeAuth) {
        this.unsubscribeAuth();
        this.unsubscribeAuth = null;
      }
    };
  }

  private async hydrateUser(id: string, email: string): Promise<void> {
    // Set basic user immediately
    this._currentUser = { id, email, displayName: null, avatarUrl: null };
    this.notify();

    // Enrich with profile data
    const profile = await fetchProfile(this.supabase, id);
    if (profile) {
      this._currentUser = {
        id,
        email: profile.email || email,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
      };
      this.notify();
    }
  }

  private notify(): void {
    const user = this._currentUser;
    for (const cb of this.listeners) {
      cb(user);
    }
  }
}
