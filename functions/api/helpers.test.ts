import { describe, expect, it } from "vitest";
import {
  buildSearchSnippet,
  buildUntaggedArticleFilter,
  formatArticleResponse,
  json,
  remainingCooldownSeconds,
  normalizedTags,
  slugify,
  timestampSlug,
  validateArticleInput,
  validateMessageInput,
  normalizeReplyTarget,
  pixhostFullImageUrl,
  verifyGuestbookCaptcha
} from "./[[path]]";

describe("api helpers", () => {
  it("marks JSON API responses as non-cacheable", () => {
    const response = json({ ok: true });

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  });

  it("formats public article view counts without exposing visitor details", () => {
    const article = formatArticleResponse(
      {
        id: 1,
        slug: "post-1",
        title: "Post",
        excerpt: "Summary",
        cover_image_url: "",
        content_md: "Body",
        visibility: "public",
        access_password: "",
        view_count: 7,
        created_at: "2026-07-22 08:00:00",
        updated_at: "2026-07-22 08:00:00",
        pinned_at: "2026-07-23T08:00:00.000Z"
      },
      []
    );

    expect(article.viewCount).toBe(7);
    expect(article.id).toBe(1);
    expect(article.pinnedAt).toBe("2026-07-23T08:00:00.000Z");
    expect(JSON.stringify(article)).not.toMatch(/ipAddress|userAgent|visitorHash/);
  });

  it("creates readable slugs for English and Chinese titles", () => {
    expect(slugify("Hello Cloudflare Pages!")).toBe("hello-cloudflare-pages");
    expect(slugify("我的 第一篇文章")).toBe("我的-第一篇文章");
  });

  it("creates timestamp slugs for new articles", () => {
    expect(timestampSlug(new Date("2026-05-20T00:00:00.000Z"))).toBe("1779235200000");
  });

  it("normalizes tags and limits the count", () => {
    const tags = normalizedTags([" D1 ", "D1", "Pages", "Workers", "Markdown", "React", "Vite", "CSS", "Auth", "Blog", "UI", "Deploy", "Extra"]);
    expect(tags).toHaveLength(12);
    expect(tags.slice(0, 3)).toEqual(["D1", "Pages", "Workers"]);
  });

  it("validates article input", () => {
    expect(
      validateArticleInput({
        title: "Post",
        content: "Body",
        coverImageUrl: " https://example.com/cover.png ",
        visibility: "private",
        tags: ["Cloudflare"]
      })
    ).toMatchObject({
      title: "Post",
      content: "Body",
      coverImageUrl: "https://example.com/cover.png",
      visibility: "private",
      tags: ["Cloudflare"]
    });

    expect(
      validateArticleInput({
        title: "Protected",
        content: "Body",
        visibility: "password",
        accessPassword: "A2b9",
        tags: []
      })
    ).toMatchObject({ visibility: "password", accessPassword: "A2b9" });
    expect(() =>
      validateArticleInput({ title: "Protected", content: "Body", visibility: "password", accessPassword: "bad", tags: [] })
    ).toThrow();
  });

  it("converts Pixhost thumbnail URLs to full-resolution image URLs", () => {
    expect(pixhostFullImageUrl("https://t42.pixhost.to/thumbs/123/456_image.webp")).toBe(
      "https://img42.pixhost.to/images/123/456_image.webp"
    );
    expect(() => pixhostFullImageUrl("https://example.com/image.webp")).toThrow();
  });

  it("shows a body search snippet when the title and excerpt do not contain the query", () => {
    const snippet = buildSearchSnippet(
      {
        title: "Post",
        excerpt: "A short summary",
        content_md: "# Heading\n\n这里是正文，包含一个隐藏在列表外的关键词。"
      },
      "关键词"
    );

    expect(snippet).toContain("关键词");
    expect(buildSearchSnippet({ title: "关键词", excerpt: "", content_md: "正文也有关键词" }, "关键词")).toBe("");
  });

  it("builds authentication-aware filters for untagged article counts", () => {
    const publicFilter = buildUntaggedArticleFilter(false, "  Cloudflare ");

    expect(publicFilter.where).toContain("a.visibility = 'public'");
    expect(publicFilter.where).toContain("NOT EXISTS");
    expect(publicFilter.bindings).toEqual(["%Cloudflare%", "%Cloudflare%", "%Cloudflare%"]);
    expect(buildUntaggedArticleFilter(true, "").where).not.toContain("a.visibility = 'public'");
  });

  it("validates guest message input and requires guest-only fields", () => {
    expect(
      validateMessageInput(
        {
          nickname: "访客",
          email: "guest@example.com",
          content: "你好",
          captchaToken: "token",
          captchaAnswer: "8"
        },
        false
      )
    ).toMatchObject({
      nickname: "访客",
      email: "guest@example.com",
      content: "你好",
      parentId: null,
      articleId: null
    });
    expect(() => validateMessageInput({ nickname: "很长很长很长很长很长很长", email: "guest@example.com", content: "你好", captchaToken: "t", captchaAnswer: "1" }, false)).toThrow();
    expect(() => validateMessageInput({ nickname: "访客", content: "你好", captchaToken: "t", captchaAnswer: "1" }, false)).toThrow();
  });

  it("lets administrators skip email and captcha while using the default nickname", () => {
    expect(validateMessageInput({ nickname: "", email: "", content: "管理员回复", articleId: 12 }, true)).toMatchObject({
      nickname: "仰晨",
      email: "",
      content: "管理员回复",
      articleId: 12
    });
    expect(() => validateMessageInput({ nickname: "", content: "评论", articleId: -1 }, true)).toThrow();
  });

  it("flattens replies to replies under the original parent", () => {
    expect(() => normalizeReplyTarget(null)).toThrow();
    expect(normalizeReplyTarget({ id: 1, parent_id: null, nickname: "主留言" })).toEqual({
      parentId: 1,
      replyToNickname: ""
    });
    expect(normalizeReplyTarget({ id: 2, parent_id: 1, nickname: "子回复" })).toEqual({
      parentId: 1,
      replyToNickname: "子回复"
    });
  });

  it("calculates guest message cooldown", () => {
    expect(remainingCooldownSeconds(1_000, 31_000)).toBe(90);
    expect(remainingCooldownSeconds(1_000, 130_000)).toBe(0);
  });

  it("verifies signed guestbook captchas", async () => {
    const payload = btoa(JSON.stringify({ answer: 9, expiresAt: 2_000_000 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const signature = await crypto.subtle.sign(
      "HMAC",
      await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
      new TextEncoder().encode(payload)
    );
    const token = `${payload}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;

    expect(await verifyGuestbookCaptcha("secret", token, "9", 1_000_000)).toBe(true);
    expect(await verifyGuestbookCaptcha("secret", token, "8", 1_000_000)).toBe(false);
    expect(await verifyGuestbookCaptcha("secret", token, "9", 3_000_000)).toBe(false);
  });
});
