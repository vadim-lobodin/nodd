import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export type DeltaHandler = {
  onThreadChange: (payload: any) => void;
  onCommentChange: (payload: any) => void;
  onError: () => void;
};

export function createRealtimeChannel(
  supabase: SupabaseClient,
  projectId: string,
  handlers: DeltaHandler,
): RealtimeChannel {
  const channel = supabase.channel(`align:project:${projectId}`);

  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'threads',
      filter: `project_id=eq.${projectId}`,
    },
    handlers.onThreadChange,
  );

  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'comments',
    },
    handlers.onCommentChange,
  );

  channel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      handlers.onError();
    }
  });

  return channel;
}
