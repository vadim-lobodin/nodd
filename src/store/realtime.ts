import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export type RowPayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, any>;
  old: Record<string, any>;
};

export type DeltaHandler = {
  onThreadChange: (payload: RowPayload) => void;
  onCommentChange: (payload: RowPayload) => void;
  onError: () => void;
};

export type RealtimeSubscription = {
  dispose: () => void;
};

export function createRealtimeChannel(
  supabase: SupabaseClient,
  projectId: string,
  handlers: DeltaHandler,
): RealtimeSubscription {
  let channel: RealtimeChannel | null = null;
  let disposed = false;

  // Starting a WebSocket synchronously inside an effect races React Strict
  // Mode's setup -> cleanup -> setup probe. Let the effect lifecycle settle
  // first so a throwaway store never opens a socket only to close it while it
  // is still CONNECTING.
  const subscribeTimer = setTimeout(() => {
    if (disposed) return;

    const nextChannel = supabase.channel(`align:project:${projectId}`);
    channel = nextChannel;

    nextChannel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'threads',
        filter: `project_id=eq.${projectId}`,
      },
      handlers.onThreadChange,
    );

    nextChannel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'comments',
      },
      handlers.onCommentChange,
    );

    nextChannel.subscribe((status) => {
      if (disposed) return;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        handlers.onError();
      }
    });
  }, 0);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(subscribeTimer);

      const activeChannel = channel;
      channel = null;
      if (activeChannel) {
        void supabase.removeChannel(activeChannel).catch(() => {
          // Cleanup is best-effort; the client also drops disconnected
          // channels internally and will reconnect remaining channels.
        });
      }
    },
  };
}
