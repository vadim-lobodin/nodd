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
  private _hasExplicitName = false;
  private listeners = new Set<AuthChangeCallback>();
  private unsubscribeAuth: (() => void) | null = null;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  get currentUser(): CurrentUser | null {
    return this._currentUser;
  }

  async signIn(email: string, displayName?: string): Promise<void> {
    const name = displayName?.trim();
    const { error } = await this.supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: typeof window !== 'undefined'
          ? window.location.origin + window.location.pathname + window.location.search
          : undefined,
        ...(name ? { data: { display_name: name } } : {}),
      },
    });
    if (error) throw error;
  }

  /** True when the user is logged in but hasn't set a display name yet. */
  get needsDisplayName(): boolean {
    return this._currentUser !== null && this._hasExplicitName === false;
  }

  async setDisplayName(name: string): Promise<void> {
    const { error } = await this.supabase.auth.updateUser({
      data: { display_name: name },
    });
    if (error) throw error;
    if (this._currentUser) {
      this._currentUser = { ...this._currentUser, displayName: name };
      this._hasExplicitName = true;
      this.notify();
    }
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
      this._hasExplicitName = !!session.user.user_metadata?.display_name;
      await this.hydrateUser(session.user.id, session.user.email ?? '');
    } else {
      this._currentUser = null;
      this.notify();
    }
    return this._currentUser;
  }

  onAuthChange(callback: AuthChangeCallback): () => void {
    this.listeners.add(callback);

    // Set up Supabase auth listener on first subscriber. Supabase fires
    // 'INITIAL_SESSION' exactly once after registration, replacing the
    // need for a separate restoreSession() call (which would race the
    // auth lock under Strict Mode double-mount).
    if (!this.unsubscribeAuth) {
      const { data: { subscription } } = this.supabase.auth.onAuthStateChange(
        async (event: AuthChangeEvent, session: Session | null) => {
          if (
            event === 'INITIAL_SESSION' ||
            event === 'SIGNED_IN' ||
            event === 'TOKEN_REFRESHED' ||
            event === 'USER_UPDATED'
          ) {
            if (session?.user) {
              this._hasExplicitName = !!session.user.user_metadata?.display_name;
              await this.hydrateUser(session.user.id, session.user.email ?? '');
            } else if (event === 'INITIAL_SESSION') {
              // No persisted session — emit null so consumers stop waiting.
              this._currentUser = null;
              this.notify();
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
