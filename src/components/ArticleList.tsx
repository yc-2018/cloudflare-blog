import React from "react";
import { ArrowLeft, Archive, FilePenLine, Lock, Pin, Trash2 } from "lucide-react";
import type { ArticleSummary, Tag as TagType } from "../types";
import { formatArticleTimeTitle, formatDate } from "../utils";
import { ArticleViewCount } from "../ArticleViewCount";
import { ButtonSpinner, EmptyState } from "./Feedback";

/** 渲染文章搜索结果和管理员操作，并展示分页加载状态。 */
export function ArticleList(props: {
  articles: ArticleSummary[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  search: string;
  selectedTagName: string;
  authenticated: boolean;
  editingSlug: string;
  openingSlug: string;
  deletingSlug: string;
  pinningSlug: string;
  onOpen: (slug: string) => void;
  onEdit: (slug: string) => void;
  onDelete: (slug: string) => void;
  onTogglePinned: (slug: string, pinned: boolean) => void;
}) {
  const hasSearch = props.search.trim().length > 0;
  if (props.loading && !props.openingSlug && !props.editingSlug) {
    return <ArticleListSkeleton />;
  }

  if (!props.loading && props.articles.length === 0) {
    if (hasSearch) {
      return <EmptyState title="没有匹配的文章" description={`没有找到包含“${props.search.trim()}”的文章。`} />;
    }

    if (props.selectedTagName) {
      return <EmptyState title="这个标签下没有文章" description="换个标签或清空筛选后再看看。" />;
    }

    return <EmptyState title="还没有文章" description="登录后可以写下第一篇 Markdown 文章。" />;
  }

  return (
    <>
      <div className="article-list">
        {props.articles.map((article) => (
          <article className={article.coverImageUrl ? "article-row has-cover" : "article-row"} key={article.slug}>
            {props.openingSlug === article.slug && (
              <div className="row-loading-overlay" aria-hidden="true">
                <ButtonSpinner />
              </div>
            )}
            {article.coverImageUrl && (
              <button
                className="article-cover"
                type="button"
                onClick={() => props.onOpen(article.slug)}
                aria-label={`打开文章：${article.title}`}
                disabled={Boolean(props.openingSlug)}
              >
                <img src={article.coverImageUrl} alt="" loading="lazy" />
              </button>
            )}
            <button className="article-main" type="button" onClick={() => props.onOpen(article.slug)} disabled={Boolean(props.openingSlug)}>
              <h2>
                {article.pinnedAt && <span className="article-pin-badge"><Pin size={14} />置顶</span>}
                {article.title}
              </h2>
              {article.excerpt && <p className="article-excerpt">{article.excerpt}</p>}
              {article.searchSnippet && (
                <p className="search-snippet">
                  <span className="search-snippet-label">正文命中</span>
                  <span className="search-snippet-text">
                    <HighlightedSnippet query={props.search} text={article.searchSnippet} />
                  </span>
                </p>
              )}
              <TagList tags={article.tags} />
              <span className="article-row-meta">
                <span className="article-date" title={formatArticleTimeTitle(article.createdAt, article.updatedAt)}>
                  {formatDate(article.updatedAt)}
                </span>
                <ArticleViewCount count={article.viewCount} />
              </span>
            </button>
            <div className="row-actions">
              {article.visibility === "private" && <Lock size={16} aria-label="登录可见" />}
              {article.visibility === "password" && <Lock size={16} aria-label="密码可见" />}
              {props.authenticated && (
                <>
                  <button
                    className="icon-button subtle"
                    type="button"
                    onClick={() => props.onTogglePinned(article.slug, !article.pinnedAt)}
                    aria-label={article.pinnedAt ? "取消置顶文章" : "置顶文章"}
                    title={article.pinnedAt ? "取消置顶" : "置顶"}
                    disabled={Boolean(props.editingSlug || props.openingSlug || props.deletingSlug || props.pinningSlug)}
                  >
                    {props.pinningSlug === article.slug ? <ButtonSpinner /> : <Pin size={16} fill={article.pinnedAt ? "currentColor" : "none"} />}
                  </button>
                  <button
                    className="icon-button subtle"
                    type="button"
                    onClick={() => props.onEdit(article.slug)}
                    aria-label="编辑文章"
                    disabled={Boolean(props.editingSlug || props.openingSlug || props.deletingSlug || props.pinningSlug)}
                  >
                    {props.editingSlug === article.slug ? <ButtonSpinner /> : <FilePenLine size={16} />}
                  </button>
                  <button
                    className="icon-button subtle danger-icon"
                    type="button"
                    onClick={() => props.onDelete(article.slug)}
                    aria-label="删除文章"
                    disabled={Boolean(props.editingSlug || props.openingSlug || props.deletingSlug || props.pinningSlug)}
                  >
                    {props.deletingSlug === article.slug ? <ButtonSpinner /> : <Trash2 size={16} />}
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {(props.loadingMore || props.hasMore) && (
        props.loadingMore ? (
          <ArticleListSkeleton compact />
        ) : (
          <div className="load-more-status" aria-live="polite">
            继续下滑加载更多
          </div>
        )
      )}
    </>
  );
}

/** 渲染回收站列表及查看、恢复和永久删除操作。 */
export function DeletedArticleList(props: {
  articles: ArticleSummary[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  action: string;
  openingSlug: string;
  onBack: () => void;
  onOpen: (slug: string) => void;
  onLoadMore: () => void;
  onRestore: (slug: string) => void;
  onDelete: (slug: string) => void;
}) {
  if (props.loading) {
    return <ArticleListSkeleton />;
  }

  return (
    <>
      <div className="content-heading compact">
        <div>
          <span className="eyebrow">管理员</span>
          <h1>文章回收站</h1>
        </div>
        <button className="text-button ghost" type="button" onClick={props.onBack}>
          <ArrowLeft size={16} />
          返回文章
        </button>
      </div>
      {props.articles.length === 0 ? (
        <EmptyState title="回收站为空" description="删除的文章会先放在这里，只有这里的删除才是永久删除。" />
      ) : (
        <div className="article-list trash-article-list">
          {props.articles.map((article) => (
            <article className={article.coverImageUrl ? "article-row has-cover" : "article-row"} key={article.slug}>
              {article.coverImageUrl && (
                <div className="article-cover static-cover">
                  <img src={article.coverImageUrl} alt="" loading="lazy" />
                </div>
              )}
              <button
                className="article-main"
                type="button"
                onClick={() => props.onOpen(article.slug)}
                disabled={Boolean(props.action || props.openingSlug)}
                aria-label={`查看文章 ${article.title}`}
              >
                <h2>{article.title}</h2>
                {article.excerpt && <p className="article-excerpt">{article.excerpt}</p>}
                <TagList tags={article.tags} />
                <span className="article-row-meta">
                  <span className="article-date" title={formatArticleTimeTitle(article.createdAt, article.updatedAt)}>
                    {formatDate(article.updatedAt)}
                  </span>
                  <span>已删除</span>
                </span>
              </button>
              <div className="row-actions trash-row-actions">
                {props.openingSlug === article.slug && <ButtonSpinner />}
                <button
                  className="text-button ghost"
                  type="button"
                  onClick={() => props.onRestore(article.slug)}
                  disabled={Boolean(props.action)}
                >
                  {props.action === `restore-${article.slug}` ? <ButtonSpinner /> : <Archive size={16} />}
                  恢复
                </button>
                <button
                  className="text-button danger"
                  type="button"
                  onClick={() => props.onDelete(article.slug)}
                  disabled={Boolean(props.action)}
                >
                  {props.action === `permanent-${article.slug}` ? <ButtonSpinner /> : <Trash2 size={16} />}
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {props.hasMore && (
        <button className="text-button full load-more-button" type="button" onClick={props.onLoadMore} disabled={props.loadingMore}>
          {props.loadingMore ? <ButtonSpinner /> : null}
          {props.loadingMore ? "加载中..." : "加载更多"}
        </button>
      )}
    </>
  );
}

/** 显示文章列表首次加载或追加加载时的占位布局。 */
function ArticleListSkeleton(props: { compact?: boolean }) {
  const count = props.compact ? 2 : 4;

  return (
    <div className={props.compact ? "article-list-skeleton compact" : "article-list-skeleton"} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="article-row skeleton-row has-cover" key={index}>
          <div className="skeleton-cover" />
          <div className="skeleton-lines">
            <span className="skeleton-line title" />
            <span className="skeleton-line text" />
            <span className="skeleton-line short" />
            <div className="skeleton-tags">
              <span />
              <span />
            </div>
          </div>
          <span className="skeleton-action" />
        </div>
      ))}
    </div>
  );
}

/** 在正文片段中高亮匹配的搜索词，且不注入 HTML。 */
function HighlightedSnippet(props: { query: string; text: string }) {
  const query = props.query.trim(); // 片段中需要高亮的搜索词。
  if (!query) {
    return <>{props.text}</>;
  }

  const lowerText = props.text.toLowerCase(); // 转小写的片段，用于查找所有匹配。
  const lowerQuery = query.toLowerCase(); // 转小写的查询词，用于忽略大小写匹配。
  const parts: React.ReactNode[] = [];
  let cursor = 0; // 拆分片段时的当前文本偏移量。
  let matchIndex = lowerText.indexOf(lowerQuery);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(props.text.slice(cursor, matchIndex));
    }

    const endIndex = matchIndex + query.length; // 高亮词的结束偏移量。
    parts.push(<mark key={`${matchIndex}-${endIndex}`}>{props.text.slice(matchIndex, endIndex)}</mark>);
    cursor = endIndex;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < props.text.length) {
    parts.push(props.text.slice(cursor));
  }

  return <>{parts}</>;
}

/** 展示文章已有的标签，空标签列表不占用布局。 */
function TagList(props: { tags: TagType[] }) {
  if (props.tags.length === 0) {
    return null;
  }

  return (
    <div className="tag-list">
      {props.tags.map((tag) => (
        <span key={tag.slug}>#{tag.name}</span>
      ))}
    </div>
  );
}
