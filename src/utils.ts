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

/** Formats a stored UTC timestamp for comments with the visitor's local date and time. */
export function formatDateTime(value: string) {
  const normalizedValue = value.includes(" ") && !value.includes("T") ? `${value.replace(" ", "T")}Z` : value; // Normalized SQLite UTC timestamp.

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(normalizedValue));
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

这里写正文。支持 **粗体**、*斜体*、~~删除线~~、[链接](https://example.com)、\`行内代码\`、==高亮文本== 和 <kbd>Ctrl</kbd> 键。

> 这是一段引用，可以用来强调观点或摘录内容。

## 列表与待办

1. 第一项
2. 第二项

- [x] 写下想法
- [ ] 继续完善

## 表格

| 功能 | Markdown 写法 | 状态 |
| --- | --- | --- |
| 表格 | GFM 表格语法 | 支持 |
| 代码高亮 | 围栏代码块 | 支持 |

---

\`\`\`ts
const hello = "Cloudflare";
console.log(hello);
\`\`\`
`;
}
