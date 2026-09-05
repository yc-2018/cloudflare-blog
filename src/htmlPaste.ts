/** 富文本粘贴中被识别出来的一张待转存图片。 */
export interface PastedImage {
  marker: string; // 先写进正文占位、转存完成后被替换掉的 Markdown 图片语法。
  sourceUrl: string; // 图片的原始地址，转存失败时回退使用。
}

/** 富文本粘贴的解析结果：可直接写入编辑器的正文，以及其中的待转存图片。 */
export interface PastedContent {
  text: string; // 保留了段落与图片位置的纯文本正文。
  images: PastedImage[]; // 按出现顺序排列的待转存图片。
}

// 需要在前后补换行、以保留段落结构的块级标签；<br> 也在其中，因此会形成段落分隔。
const blockTags = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
  "ol", "p", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul"
]);

// 内容对正文没有意义、需要整棵子树跳过的标签。
const skipTags = new Set(["head", "iframe", "noscript", "script", "style", "svg", "template", "title"]);

// 图片地址可能出现的属性，懒加载站点常把真实地址放在 data-* 上而让 src 指向占位图。
const imageSourceAttributes = ["data-src", "data-original", "data-actualsrc", "src"];

/**
 * 把剪贴板里的 HTML 转成纯文本正文，并在每张图片的原位插入由 createMarker 生成的占位标记。
 * 只保留段落结构与代码块缩进，不还原加粗、标题等行内格式。
 */
export function parsePastedHtml(html: string, createMarker: () => string): PastedContent {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images: PastedImage[] = [];
  const parts: string[] = [];

  /** 递归遍历节点；preformatted 为真时保留原始空白，用于 <pre> 中的代码。 */
  const visit = (node: Node, preformatted: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? "";
      parts.push(preformatted ? value : value.replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (skipTags.has(tag)) {
      return;
    }

    if (tag === "img") {
      const sourceUrl = pastedImageSource(element);
      if (sourceUrl) {
        const marker = createMarker();
        images.push({ marker, sourceUrl });
        parts.push(`\n${marker}\n`);
      }
      return;
    }

    if (tag === "pre") {
      parts.push("\n```\n");
      element.childNodes.forEach((child) => visit(child, true));
      parts.push("\n```\n");
      return;
    }

    const isBlock = blockTags.has(tag); // 是否需要在该标签前后补换行。
    if (isBlock) {
      parts.push("\n");
    }
    element.childNodes.forEach((child) => visit(child, preformatted));
    if (isBlock) {
      parts.push("\n");
    }
  };

  doc.body.childNodes.forEach((child) => visit(child, false));

  const text = parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, images };
}

/** 依次尝试常见的图片地址属性，只接受绝对的 http(s) 地址。 */
function pastedImageSource(element: Element) {
  for (const attribute of imageSourceAttributes) {
    // 读取原始属性值，避免 DOMParser 把相对地址解析成本站地址。
    const value = (element.getAttribute(attribute) ?? "").trim();
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
  }
  return "";
}
