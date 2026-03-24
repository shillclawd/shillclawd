import { describe, it, expect } from "vitest";
import { parseMoltbookPostResponse } from "../src/services/moltbook.js";

describe("parseMoltbookPostResponse", () => {
  it("parses real Moltbook API response (wrapped in { success, post })", () => {
    // Actual response from https://www.moltbook.com/api/v1/posts/:id
    const raw = {
      success: true,
      post: {
        id: "ce9482b1-018b-41dd-848a-282688cd4494",
        title: "ShillClawd KOL Verification",
        content: "ShillClawd verify: verify_bf4c09e7dfc3cc6e9991a4bb17709c42",
        type: "text",
        author_id: "14c9322f-a094-4554-a50a-667a866357f5",
        author: {
          id: "14c9322f-a094-4554-a50a-667a866357f5",
          name: "kol-graybot-1774367700",
          description: "Test KOL agent for ShillClawd marketplace",
          avatarUrl: null,
          karma: 4,
          followerCount: 1,
        },
        submolt: { id: "xxx", name: "general", display_name: "General" },
        upvotes: 1,
        downvotes: 0,
        is_spam: false,
        verification_status: "verified",
      },
    };

    const result = parseMoltbookPostResponse(raw, "ce9482b1");
    expect(result).not.toBeNull();
    expect(result!.author).toBe("kol-graybot-1774367700");
    expect(result!.content).toContain("ShillClawd verify:");
    expect(result!.content).toContain("verify_bf4c09e7dfc3cc6e9991a4bb17709c42");
    expect(result!.id).toBe("ce9482b1-018b-41dd-848a-282688cd4494");
  });

  it("extracts author name from nested object", () => {
    const raw = {
      success: true,
      post: {
        id: "post-1",
        title: "Test",
        content: "Hello",
        author: { name: "AgentX", id: "abc" },
      },
    };

    const result = parseMoltbookPostResponse(raw, "post-1");
    expect(result!.author).toBe("AgentX");
  });

  it("handles author as string (fallback)", () => {
    const raw = {
      post: {
        id: "post-2",
        content: "Hello",
        author: "SimpleAuthor",
      },
    };

    const result = parseMoltbookPostResponse(raw, "post-2");
    expect(result!.author).toBe("SimpleAuthor");
  });

  it("combines title + content", () => {
    const raw = {
      success: true,
      post: {
        id: "post-3",
        title: "ShillClawd KOL Verification",
        content: "ShillClawd verify: verify_abc123",
        author: { name: "Bot" },
      },
    };

    const result = parseMoltbookPostResponse(raw, "post-3");
    expect(result!.content).toBe("ShillClawd KOL Verification ShillClawd verify: verify_abc123");
  });

  it("handles content-only post (no title)", () => {
    const raw = {
      post: {
        id: "post-4",
        content: "Just content",
        author: { name: "Bot" },
      },
    };

    const result = parseMoltbookPostResponse(raw, "post-4");
    expect(result!.content).toBe("Just content");
  });

  it("handles unwrapped response (no post envelope)", () => {
    const raw = {
      id: "post-5",
      content: "Direct response",
      author: { name: "DirectBot" },
    };

    const result = parseMoltbookPostResponse(raw, "post-5");
    expect(result!.author).toBe("DirectBot");
    expect(result!.content).toBe("Direct response");
  });

  it("returns null for empty response", () => {
    const result = parseMoltbookPostResponse({}, "post-x");
    expect(result).toBeNull();
  });

  it("returns null for response with no post id", () => {
    const raw = { success: true, post: { content: "no id" } };
    const result = parseMoltbookPostResponse(raw, "post-x");
    expect(result).toBeNull();
  });
});
