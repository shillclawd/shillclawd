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
  const raw = await res.json();
  // Moltbook wraps response in { success, post: { ... } }
  const data = raw.post ?? raw;
  // Author is object { name, id, ... } or string
  const authorName = typeof data.author === "object" ? data.author.name : data.author;
  // Content may be in title, content, or both
  const fullContent = [data.title, data.content].filter(Boolean).join(" ");

  return {
    id: data.id,
    author: authorName,
    content: fullContent,
    url: data.url || `https://moltbook.com/post/${postId}`,
  };
}

export async function fetchMoltbookProfile(moltbookName: string): Promise<MoltbookProfile | null> {
  const res = await fetch(`${MOLTBOOK_API_BASE}/agents/profile?name=${encodeURIComponent(moltbookName)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    karma: data.karma ?? 0,
    followers: data.follower_count ?? data.followers ?? 0,
    posts_count: data.posts_count ?? 0,
    top_submolts: data.top_submolts ?? [],
    owner_x_followers: data.owner_x_followers ?? 0,
  };
}
