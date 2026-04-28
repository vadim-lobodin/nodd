import { SupabaseClient } from '@supabase/supabase-js';
import type { Pin, UserId } from './types';

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
  },
): Promise<{ threadId: string; commentId: string }> {
  const { data: thread, error: threadErr } = await supabase
    .from('threads')
    .insert({
      project_id: input.projectId,
      url_path: input.urlPath,
      pin: input.pin,
      state_key: input.stateKey,
      created_by: input.createdBy,
    })
    .select('id')
    .single();

  if (threadErr || !thread) throw threadErr ?? new Error('Failed to create thread');

  const { data: comment, error: commentErr } = await supabase
    .from('comments')
    .insert({
      thread_id: thread.id,
      author_id: input.createdBy,
      body: input.body,
      mentions: input.mentions,
    })
    .select('id')
    .single();

  if (commentErr || !comment) throw commentErr ?? new Error('Failed to create comment');

  return { threadId: thread.id, commentId: comment.id };
}

export async function insertComment(
  supabase: SupabaseClient,
  input: {
    threadId: string;
    body: string;
    mentions: UserId[];
    authorId: UserId;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from('comments')
    .insert({
      thread_id: input.threadId,
      author_id: input.authorId,
      body: input.body,
      mentions: input.mentions,
    })
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('Failed to create comment');
  return data.id;
}

export async function updateThreadResolved(
  supabase: SupabaseClient,
  threadId: string,
  resolved: boolean,
  userId: UserId,
): Promise<void> {
  const { error } = await supabase
    .from('threads')
    .update({
      resolved,
      resolved_by: resolved ? userId : null,
      resolved_at: resolved ? new Date().toISOString() : null,
    })
    .eq('id', threadId);

  if (error) throw error;
}
