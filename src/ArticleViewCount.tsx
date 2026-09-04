import { Eye } from "lucide-react";

/** 展示归一化后的公开文章浏览总数，不暴露具体访问明细。 */
export function ArticleViewCount(props: { count: number }) {
  const count = Number.isFinite(props.count) ? Math.max(0, Math.floor(props.count)) : 0; // 向访客展示的稳定非负总数。
  const label = `${count} 次浏览`; // 可见文本与悬浮提示共用的内容。

  return (
    <span className="article-view-count" title={label}>
      <Eye size={15} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
