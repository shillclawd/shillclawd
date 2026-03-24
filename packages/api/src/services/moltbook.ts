const MOLTBOOK_API_BASE = process.env.MOLTBOOK_API_BASE || "https://www.moltbook.com/api/v1";

export interface MoltbookPost {
  id: string;
  author: string;
  content: string;
  url: string;
}

export interface MoltbookProfile {
  karma: number;
  followers: number;
  posts_count: number;
  top_submolts: string[];
  owner_x_followers: number;
}

export async function fetchMoltbookPost(postId: string): Promise<MoltbookPost | null> {
  const res = await fetch(`${MOLTBOOK_API_BASE}/posts/${postId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    id: data.id,
    author: data.author,
    content: data.content,
    url: data.url || `https://moltbook.com/post/${postId}`,
  };
}

export async function fetchMoltbookProfile(moltbookName: string): Promise<MoltbookProfile | null> {
  const res = await fetch(`${MOLTBOOK_API_BASE}/users/${moltbookName}`);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    karma: data.karma,
    followers: data.followers,
    posts_count: data.posts_count,
    top_submolts: data.top_submolts || [],
    owner_x_followers: data.owner_x_followers || 0,
  };
}
