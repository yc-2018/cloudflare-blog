import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./App";

describe("MarkdownRenderer", () => {
  it("renders double equals text as a highlighted mark and preserves kbd tags", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content="这一段 ==重点==，按 <kbd>Ctrl</kbd>。" />);

    expect(html).toContain("<mark>重点</mark>");
    expect(html).toContain("<kbd>Ctrl</kbd>");
    expect(html).not.toContain("==重点==");
  });

  it("renders standalone highlights in headings and other phrasing contexts", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={'# ==标题==\n\n==整段==\n\n- ==列表项==\n\n[==链接文字==](https://example.com)\n\n| 列 |\n| --- |\n| ==表格内容== |'}
      />
    );

    expect(html).toContain("<h1><mark>标题</mark></h1>");
    expect(html).toContain("<p><mark>整段</mark></p>");
    expect(html).toContain("<li><mark>列表项</mark></li>");
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer"><mark>链接文字</mark></a>'
    );
    expect(html).toContain("<td><mark>表格内容</mark></td>");
  });

  it("does not parse highlight markers inside inline or fenced code", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content={'`==行内代码==`\n\n```text\n==代码块==\n```'} />);

    expect(html).toContain("<code>==行内代码==</code>");
    expect(html).toContain("==代码块==");
    expect(html).not.toContain("<mark>行内代码</mark>");
    expect(html).not.toContain("<mark>代码块</mark>");
  });

  it("supports inline markdown inside highlighted text", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content="==包含 **加粗** 的高亮==" />);

    expect(html).toContain("<mark>包含 <strong>加粗</strong> 的高亮</mark>");
  });

  it("keeps allowed inline HTML while stripping unsafe raw HTML", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={'<kbd class="ignored">A</kbd><u>下划线</u><small>注释</small><script>alert(1)</script>'} />
    );

    expect(html).toContain("<kbd>A</kbd>");
    expect(html).toContain("<u>下划线</u>");
    expect(html).toContain("<small>注释</small>");
    expect(html).not.toContain("class=");
    expect(html).not.toContain("<script>");
  });

  it("keeps legacy font text in headings while discarding its unsafe presentation style", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={'## <font style="color:rgb(51, 51, 51);">Mysql为什么使用B+树作为索引结构？</font>'} />
    );

    expect(html).toContain("<h2>Mysql为什么使用B+树作为索引结构？</h2>");
    expect(html).not.toContain("<font");
    expect(html).not.toContain("style=");
  });

  it("opens Markdown and automatically detected URLs in a new tab", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={'[站点](https://example.com)\n\nhttps://example.org/path'} />
    );

    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">站点</a>');
    expect(html).toContain(
      '<a href="https://example.org/path" target="_blank" rel="noopener noreferrer">https://example.org/path</a>'
    );
  });
});
