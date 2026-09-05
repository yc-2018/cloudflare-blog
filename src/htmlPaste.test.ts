// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { parsePastedHtml } from "./htmlPaste";

/** 生成可预测的占位标记，便于断言图片在正文中的位置。 */
function markerFactory() {
  let index = 0;
  return () => `![图片上传中…](uploading-${(index += 1)})`;
}

describe("parsePastedHtml", () => {
  it("保留段落文本并在图片原位插入占位标记", () => {
    const parsed = parsePastedHtml(
      '<p>上文</p><p><img src="https://example.com/a.png"></p><p>下文</p>',
      markerFactory()
    );

    expect(parsed.text).toBe("上文\n\n![图片上传中…](uploading-1)\n\n下文");
    expect(parsed.images).toEqual([{ marker: "![图片上传中…](uploading-1)", sourceUrl: "https://example.com/a.png" }]);
  });

  it("优先读取懒加载属性，并忽略无法转存的相对地址", () => {
    const parsed = parsePastedHtml(
      '<img src="/placeholder.gif" data-src="https://cdn.example.com/real.jpg"><img src="/local.png">',
      markerFactory()
    );

    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].sourceUrl).toBe("https://cdn.example.com/real.jpg");
  });

  it("跳过脚本与样式内容，并合并多余空白", () => {
    const parsed = parsePastedHtml(
      '<style>p{color:red}</style><div>  多余   空白  </div><script>alert(1)</script>',
      markerFactory()
    );

    expect(parsed.text).toBe("多余 空白");
  });

  it("保留 pre 中的代码缩进并补上围栏", () => {
    const parsed = parsePastedHtml("<pre>const a = 1;\n  const b = 2;</pre>", markerFactory());

    expect(parsed.text).toBe("```\nconst a = 1;\n  const b = 2;\n```");
  });

  it("没有图片时也返回可直接使用的正文", () => {
    const parsed = parsePastedHtml("<p>纯文本</p>", markerFactory());

    expect(parsed.images).toEqual([]);
    expect(parsed.text).toBe("纯文本");
  });
});
