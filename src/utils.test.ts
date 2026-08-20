import { describe, expect, it } from "vitest";
import { doubleMarkdownLineBreaks, formatDateTime, parseTags, sampleMarkdown, toTagInput } from "./utils";

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

describe("Markdown line break conversion", () => {
  it("doubles single line breaks without expanding existing blank lines", () => {
    expect(doubleMarkdownLineBreaks("第一行\n第二行\n\n第三行")).toEqual({
      content: "第一行\n\n第二行\n\n第三行",
      convertedCount: 1
    });
  });

  it("preserves fenced code blocks and CRLF line endings", () => {
    const content = "正文一\r\n正文二\r\n```ts\r\nconst one = 1;\r\nconst two = 2;\r\n```\r\n结尾";

    expect(doubleMarkdownLineBreaks(content)).toEqual({
      content: "正文一\r\n\r\n正文二\r\n\r\n```ts\r\nconst one = 1;\r\nconst two = 2;\r\n```\r\n结尾",
      convertedCount: 2
    });
  });
});
