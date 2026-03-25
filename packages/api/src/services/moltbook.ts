const MOLTBOOK_API_BASE = process.env.MOLTBOOK_API_BASE || "https://www.moltbook.com/api/v1";

export interface MoltbookPost {
  id: string;
  author: string;
  content: string;
  url: string;
  isSpam: boolean;
}

export interface MoltbookProfile {
  karma: number;
  followers: number;
  posts_count: number;
  top_submolts: string[];
  owner_x_followers: number;
}

// Exported for testing — parses raw Moltbook API response into MoltbookPost
export function parseMoltbookPostResponse(raw: Record<string, unknown>, postId: string): MoltbookPost | null {
  // Moltbook wraps response in { success, post: { ... } }
  const data = (raw.post ?? raw) as Record<string, unknown>;
  if (!data.id) return null;

  // Author is object { name, id, ... } or string
  const author = data.author as Record<string, unknown> | string | undefined;
  const authorName = typeof author === "object" && author !== null ? (author.name as string) : (author as string);

  // Content may be in title, content, or both
  const fullContent = [data.title, data.content].filter(Boolean).join(" ");

  return {
    id: data.id as string,
    author: authorName || "",
    content: fullContent,
    url: (data.url as string) || `https://moltbook.com/post/${postId}`,
    isSpam: !!(data.is_spam),
  };
}

export async function fetchMoltbookPost(postId: string): Promise<MoltbookPost | null> {
  const res = await fetch(`${MOLTBOOK_API_BASE}/posts/${postId}`);
  if (!res.ok) return null;
  const raw = await res.json();
  return parseMoltbookPostResponse(raw, postId);
}

export function parseMoltbookProfileResponse(raw: Record<string, unknown>): MoltbookProfile | null {
  // Moltbook wraps response in { success, agent: { ... } }
  const data = (raw.agent ?? raw) as Record<string, unknown>;
  return {
    karma: (data.karma as number) ?? 0,
    followers: (data.follower_count as number) ?? (data.followers as number) ?? 0,
    posts_count: (data.posts_count as number) ?? 0,
    top_submolts: (data.top_submolts as string[]) ?? [],
    owner_x_followers: (data.owner_x_followers as number) ?? 0,
  };
}

export async function fetchMoltbookProfile(moltbookName: string): Promise<MoltbookProfile | null> {
  const res = await fetch(`${MOLTBOOK_API_BASE}/agents/profile?name=${encodeURIComponent(moltbookName)}`);
  if (!res.ok) return null;
  const raw = await res.json();
  return parseMoltbookProfileResponse(raw);
}
