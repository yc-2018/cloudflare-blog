import { describe, expect, it } from "vitest";
import { convertStandaloneImageLinks, markdownImage, orderedImageHostProviders } from "./imageUpload";

describe("image upload helpers", () => {
  it("skips providers whose local failure cooldown is active", () => {
    expect(orderedImageHostProviders({ imgbb: 9_000 }, 10_000)).toEqual(["pixhost"]);
  });

  it("retries every provider when all providers are cooling down", () => {
    expect(orderedImageHostProviders({ imgbb: 9_000, pixhost: 9_000 }, 10_000)).toEqual(["imgbb", "pixhost"]);
  });

  it("creates Markdown image syntax", () => {
    expect(markdownImage("https://example.com/image.webp", "截图")).toBe("![截图](https://example.com/image.webp)");
  });

  it("converts standalone image URLs and preserves query strings", () => {
    const result = convertStandaloneImageLinks(
      "开头\nhttps://example.com/one.jpg\n  https://example.com/TWO.PNG?size=large#preview  \n结尾"
    );

    expect(result).toEqual({
      content: "开头\n![](https://example.com/one.jpg)\n  ![](https://example.com/TWO.PNG?size=large#preview)  \n结尾",
      convertedCount: 2
    });
  });

  it("does not alter ordinary links, existing Markdown images, or code blocks", () => {
    const content = [
      "https://example.com/article",
      "![](https://example.com/already.png)",
      "```text",
      "https://example.com/in-code.jpg",
      "```",
      "    https://example.com/indented.jpg"
    ].join("\n");

    expect(convertStandaloneImageLinks(content)).toEqual({ content, convertedCount: 0 });
  });
});
