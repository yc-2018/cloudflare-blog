import { describe, expect, it } from "vitest";
import { excerptFromContent, formatDateTime, parseTags, sampleMarkdown, toTagInput } from "./utils";

describe("tag helpers", () => {
  it("parses comma and Chinese comma separated tags", () => {
    expect(parseTags("Cloudflare, Markdown，D1")).toEqual(["Cloudflare", "Markdown", "D1"]);
  });

  it("trims and de-duplicates tags", () => {
    expect(parseTags("Cloudflare, Cloudflare,  D1  ")).toEqual(["Cloudflare", "D1"]);
  });

  it("serializes tags for editing", () => {
    expect(toTagInput([{ name: "Cloudflare" }, { name: "Markdown" }])).toBe("Cloudflare, Markdown");
  });
});

describe("date formatting", () => {
  it("includes hours and minutes for stored UTC timestamps", () => {
    expect(formatDateTime("2026-01-02 03:04:00")).toMatch(/2026\/01\/02 .*04/);
    expect(formatDateTime("2026-01-02 03:04:00")).toMatch(/\d{2}:\d{2}/);
  });
});

describe("new article Markdown example", () => {
  it("includes the supported table and common GFM examples", () => {
    const content = sampleMarkdown();

    expect(content).toContain("| 功能 | Markdown 写法 | 状态 |");
    expect(content).toContain("> 这是一段引用");
    expect(content).toContain("~~删除线~~");
    expect(content).toContain("- [x] 写下想法");
  });
});

describe("excerpt helpers", () => {
  it("extracts readable text from Markdown and limits it to 200 characters", () => {
    const content = `# 标题\n\n这是 **正文**，包含一个[链接](https://example.com)。\n\n${"后".repeat(240)}`;

    const excerpt = excerptFromContent(content);
    expect(excerpt).toContain("标题 这是 正文，包含一个链接。");
    expect(excerpt).toHaveLength(200);
  });

  it("ignores fenced code when building an excerpt", () => {
    expect(excerptFromContent("```ts\nconst hidden = true;\n```\n正文内容")).toBe("正文内容");
  });
});
