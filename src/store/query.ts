import { SupabaseClient } from '@supabase/supabase-js';
import type { Thread, Comment } from './types';

type RawThread = {
  id: string;
  project_id: string;
  url_path: string;
  pin: any;
  state_key: string | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_by: string;
  created_at: string;
  comments: RawComment[];
};

type RawComment = {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
};

function mapComment(raw: RawComment): Comment {
  return {
    id: raw.id,
    threadId: raw.thread_id,
    authorId: raw.author_id,
    body: raw.body,
    mentions: raw.mentions ?? [],
    createdAt: raw.created_at,
    editedAt: raw.edited_at,
  };
}

function mapThread(raw: RawThread): Thread {
  return {
    id: raw.id,
    projectId: raw.project_id,
    urlPath: raw.url_path,
    pin: raw.pin,
    stateKey: raw.state_key ?? '',
    resolved: raw.resolved,
    resolvedBy: raw.resolved_by,
    resolvedAt: raw.resolved_at,
    createdBy: raw.created_by,
    createdAt: raw.created_at,
    comments: (raw.comments ?? []).map(mapComment).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
  };
}

export async function fetchPageThreads(
  supabase: SupabaseClient,
  projectId: string,
  urlPath: string,
): Promise<Thread[]> {
  const { data, error } = await supabase
    .from('threads')
    .select('*, comments(*)')
    .eq('project_id', projectId)
    .eq('url_path', urlPath)
    .eq('resolved', false)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data as RawThread[]).map(mapThread);
}

export async function fetchResolvedThreads(
  supabase: SupabaseClient,
  projectId: string,
  urlPath: string,
): Promise<Thread[]> {
  const { data, error } = await supabase
    .from('threads')
    .select('*, comments(*)')
    .eq('project_id', projectId)
    .eq('url_path', urlPath)
    .eq('resolved', true)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data as RawThread[]).map(mapThread);
}
