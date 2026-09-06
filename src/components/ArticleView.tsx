import { useEffect, useState } from "react";
import React from "react";
import { ArrowLeft, ArrowUp, FilePenLine, Share2, Trash2 } from "lucide-react";
import type { Article } from "../types";
import { formatArticleTimeTitle, formatDate } from "../utils";
import { ArticleViewCount } from "../ArticleViewCount";
import { ButtonSpinner } from "./Feedback";
import { MarkdownRenderer } from "./MarkdownRenderer";

/** 展示文章正文、操作栏、评论区域和返回顶部按钮。 */
export function ArticleView(props: {
  article: Article;
  authenticated: boolean;
  deleting: boolean;
  deleted: boolean;
  editing: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onShare: () => void;
  comments: React.ReactNode;
}) {
  const [showBackToTop, setShowBackToTop] = useState(false); // 文章详情是否已滚动到足以显示快捷按钮的程度。

  useEffect(() => {
    /** 根据文章页滚动位置更新悬浮快捷按钮的可见性。 */
    const updateBackToTopVisibility = () => setShowBackToTop(window.scrollY > 240);
    window.addEventListener("scroll", updateBackToTopVisibility, { passive: true });
    updateBackToTopVisibility();
    return () => window.removeEventListener("scroll", updateBackToTopVisibility);
  }, []);

  return (
    <article className="article-page">
      <div className="page-tools">
        <button className="text-button ghost" type="button" onClick={props.onBack}>
          <ArrowLeft size={16} />
          返回
        </button>
        <button className="text-button ghost" type="button" onClick={props.onShare}>
          <Share2 size={16} />
          分享
        </button>
        {props.authenticated && !props.deleted && (
          <div className="tool-group">
            <button className="text-button ghost" type="button" onClick={props.onEdit} disabled={props.editing || props.deleting}>
              {props.editing ? <ButtonSpinner /> : <FilePenLine size={16} />}
              {props.editing ? "打开中..." : "编辑"}
            </button>
            <button className="text-button danger" type="button" onClick={props.onDelete} disabled={props.deleting || props.editing}>
              {props.deleting ? <ButtonSpinner /> : <Trash2 size={16} />}
              {props.deleting ? "删除中..." : "删除"}
            </button>
          </div>
        )}
      </div>
      <header className="article-header">
        <div className="article-meta">
          <strong className="article-meta-title">{props.article.title}</strong>
          <span className="dot" aria-hidden="true" />
          <span title={formatArticleTimeTitle(props.article.createdAt, props.article.updatedAt)}>
            {formatDate(props.article.updatedAt)}
          </span>
          <span className="dot" aria-hidden="true" />
          <ArticleViewCount count={props.article.viewCount} />
          {props.deleted && (
            <>
              <span className="dot" aria-hidden="true" />
              <span>已在回收站</span>
            </>
          )}
        </div>
      </header>
      <div className="markdown-body article-markdown">
        <MarkdownRenderer content={props.article.content} />
      </div>
      {props.comments}
      {showBackToTop && (
        <button
          className="article-back-to-top"
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="回到顶部"
          title="回到顶部"
        >
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      )}
    </article>
  );
}
