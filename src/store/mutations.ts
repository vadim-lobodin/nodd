import { SupabaseClient } from '@supabase/supabase-js';
import type { Pin, UserId } from './types';

const MUTATION_TIMEOUT_MS = 15_000;

async function withMutationTimeout<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MUTATION_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out. Check your connection and try again.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isMissingAtomicCreateRpc(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    (
      error.message?.includes('nodd_create_thread') === true &&
      error.message.toLowerCase().includes('could not find')
    )
  );
}

async function cleanupPartialThread(
  supabase: SupabaseClient,
  threadId: string,
): Promise<void> {
  try {
    await withMutationTimeout('Cleaning up partial comment', async signal => {
      await supabase.from('threads').delete().eq('id', threadId).abortSignal(signal);
    });
  } catch {
    // The atomic RPC is the normal path. This cleanup only protects projects
    // that have not applied the RPC migration yet, and remains best-effort.
  }
}

export async function insertThread(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    urlPath: string;
    pin: Pin;
    stateKey: string;
    body: string;
    mentions: UserId[];
    createdBy: UserId;
    threadId: string;
    commentId: string;
  },
): Promise<{ threadId: string; commentId: string }> {
  return withMutationTimeout('Creating comment', async signal => {
    // Newer projects use one Postgres transaction for the thread and its root
    // comment. Supplying ids client-side also lets the store suppress Realtime
    // echoes before the request starts, rather than racing the server events.
    const { error: rpcError } = await supabase
      .rpc('nodd_create_thread', {
        _thread_id: input.threadId,
        _comment_id: input.commentId,
        _project_id: input.projectId,
        _url_path: input.urlPath,
        _pin: input.pin,
        _state_key: input.stateKey,
        _body: input.body,
        _mentions: input.mentions,
      })
      .abortSignal(signal);

    if (!rpcError) {
      return { threadId: input.threadId, commentId: input.commentId };
    }
    if (!isMissingAtomicCreateRpc(rpcError)) throw rpcError;

    // Backward-compatible fallback for an existing Supabase project before it
    // applies 0005_atomic_thread_create.sql. If the second insert fails, remove
    // the otherwise-empty thread so it cannot surface as a ghost pin later.
    const { data: thread, error: threadErr } = await supabase
      .from('threads')
      .insert({
        id: input.threadId,
        project_id: input.projectId,
        url_path: input.urlPath,
        pin: input.pin,
        state_key: input.stateKey,
        created_by: input.createdBy,
      })
      .select('id')
      .abortSignal(signal)
      .single();

    if (threadErr || !thread) throw threadErr ?? new Error('Failed to create thread');

    const { data: comment, error: commentErr } = await supabase
      .from('comments')
      .insert({
        id: input.commentId,
        thread_id: input.threadId,
        author_id: input.createdBy,
        body: input.body,
        mentions: input.mentions,
      })
      .select('id')
      .abortSignal(signal)
      .single();

    if (commentErr || !comment) {
      void cleanupPartialThread(supabase, input.threadId);
      throw commentErr ?? new Error('Failed to create comment');
    }

    return { threadId: input.threadId, commentId: input.commentId };
  });
}

export async function insertComment(
  supabase: SupabaseClient,
  input: {
    threadId: string;
    body: string;
    mentions: UserId[];
    authorId: UserId;
    commentId: string;
  },
): Promise<string> {
  return withMutationTimeout('Sending reply', async signal => {
    const { data, error } = await supabase
      .from('comments')
      .insert({
        id: input.commentId,
        thread_id: input.threadId,
        author_id: input.authorId,
        body: input.body,
        mentions: input.mentions,
      })
      .select('id')
      .abortSignal(signal)
      .single();

    if (error || !data) throw error ?? new Error('Failed to create comment');
    return data.id;
  });
}

export async function deleteThread(
  supabase: SupabaseClient,
  threadId: string,
): Promise<void> {
  await withMutationTimeout('Deleting thread', async signal => {
    // Comments cascade-delete via the threads FK (on delete cascade).
    const { data, error } = await supabase
      .from('threads')
      .delete()
      .eq('id', threadId)
      .select('id')
      .abortSignal(signal)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Thread was not deleted');
  });
}

export async function deleteComment(
  supabase: SupabaseClient,
  commentId: string,
): Promise<void> {
  await withMutationTimeout('Deleting comment', async signal => {
    const { data, error } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId)
      .select('id')
      .abortSignal(signal)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Comment was not deleted');
  });
}

export async function updateThreadResolved(
  supabase: SupabaseClient,
  threadId: string,
  resolved: boolean,
  userId: UserId,
): Promise<void> {
  await withMutationTimeout(resolved ? 'Resolving thread' : 'Reopening thread', async signal => {
    const { data, error } = await supabase
      .from('threads')
      .update({
        resolved,
        resolved_by: resolved ? userId : null,
        resolved_at: resolved ? new Date().toISOString() : null,
      })
      .eq('id', threadId)
      .select('id')
      .abortSignal(signal)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Thread was not updated');
  });
}
