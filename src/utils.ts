import type { ArticleInput } from "./types";

export const emptyArticleInput: ArticleInput = {
  title: "",
  excerpt: "",
  coverImageUrl: "",
  content: "",
  visibility: "public",
  accessPassword: "",
  tags: []
};

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

/** Builds the hover hint for article date labels. */
export function formatArticleTimeTitle(createdAt: string, updatedAt: string) {
  const createdText = formatDate(createdAt);
  const updatedText = formatDate(updatedAt);

  if (createdText === updatedText) {
    return `创建时间：${createdText}`;
  }

  return `创建时间：${createdText}\n修改时间：${updatedText}`;
}

export function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

export function toTagInput(tags: { name: string }[]) {
  return tags.map((tag) => tag.name).join(", ");
}

export interface MarkdownLineBreakConversion {
  content: string;
  convertedCount: number;
}

/** Doubles single Markdown line breaks while preserving blank lines and fenced code blocks. */
export function doubleMarkdownLineBreaks(content: string): MarkdownLineBreakConversion {
  const parts = content.split(/(\r\n|\n|\r)/);
  let convertedCount = 0;
  let fenceMarker = "";

  for (let index = 0; index < parts.length - 1; index += 2) {
    const line = parts[index];
    const separator = parts[index + 1];
    const nextLine = parts[index + 2] ?? "";
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    const isFenceLine = Boolean(fenceMatch);

    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fenceMarker = fenceMarker === marker ? "" : fenceMarker || marker;
    }

    const isBlankLineBoundary = line.trim() === "" || nextLine.trim() === "";
    if (!fenceMarker && !isFenceLine && !isBlankLineBoundary) {
      parts[index + 1] = separator + separator;
      convertedCount += 1;
    }
  }

  return { content: parts.join(""), convertedCount };
}

export function articleToInput(article: {
  title: string;
  excerpt: string;
  coverImageUrl?: string;
  content: string;
  visibility: "public" | "private" | "password";
  accessPassword?: string;
  tags: { name: string }[];
}): ArticleInput {
  return {
    title: article.title,
    excerpt: article.excerpt,
    coverImageUrl: article.coverImageUrl ?? "",
    content: article.content,
    visibility: article.visibility,
    accessPassword: article.accessPassword ?? "",
    tags: article.tags.map((tag) => tag.name)
  };
}

export function sampleMarkdown() {
  return `# 新文章标题

这里写正文。支持 **粗体**、链接、任务列表、表格、代码块、==高亮文本== 和 <kbd>Ctrl</kbd> 键。

## 待办

- [x] 写下想法
- [ ] 继续完善

\`\`\`ts
const hello = "Cloudflare";
console.log(hello);
\`\`\`
`;
}
