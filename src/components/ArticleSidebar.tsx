import { Search, Tag, X } from "lucide-react";
import type { Tag as TagType } from "../types";
import { minAutoSearchLength, untaggedArticleFilter } from "../hooks/useArticleList";
import { ButtonSpinner } from "./Feedback";

/** 渲染文章搜索、标签计数与管理员回收站入口。 */
export function ArticleSidebar({
  search, tags, selectedTag, loading, loadingMore, allArticleTotal, untaggedArticleTotal,
  authenticated, showingTrash, trashLoading, deletedArticleTotal, trashDisabled,
  onSearchChange: setSearch, onNotice: setNotice, onSelectTag: selectArticleTag, onTrash: showTrash
}: {
  search: string;
  tags: TagType[];
  selectedTag: string;
  loading: boolean;
  loadingMore: boolean;
  allArticleTotal: number;
  untaggedArticleTotal: number;
  authenticated: boolean;
  showingTrash: boolean;
  trashLoading: boolean;
  deletedArticleTotal: number;
  trashDisabled: boolean;
  onSearchChange: (value: string) => void;
  onNotice: (message: string) => void;
  onSelectTag: (slug: string) => void;
  onTrash: () => void;
}) {
  const effectiveSearch = search.trim(); // 回车提示与自动搜索使用相同的去空白规则。

  return (
    <aside className="sidebar">
      <div className="search-box">
        <span className="search-hint-icon" tabIndex={0} aria-label="搜索提示">
          <Search size={18} aria-hidden="true" />
          <span className="search-tooltip" role="tooltip">
            输入2个字以上才会自动搜索。
          </span>
        </span>
        <input
          aria-label="搜索文章"
          placeholder="搜索标题、摘要或正文"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && effectiveSearch.length > 0 && effectiveSearch.length < minAutoSearchLength) {
              event.preventDefault();
              setNotice("至少输入 2 个字再搜索");
            }
          }}
        />
        {search && (
          <button className="clear-button" type="button" onClick={() => setSearch("")} aria-label="清空搜索">
            <X size={16} />
          </button>
        )}
      </div>

      <section className="tag-panel" aria-label="标签筛选">
        <div className="section-title">
          <Tag size={16} />
          标签
        </div>
        <button
          className={selectedTag ? "tag-filter" : "tag-filter active"}
          type="button"
          onClick={() => selectArticleTag("")}
          disabled={loading || loadingMore}
        >
          全部文章
          <span>{loading && !selectedTag ? <ButtonSpinner /> : allArticleTotal}</span>
        </button>
        {tags.map((tag) => (
          <button
            className={selectedTag === tag.slug ? "tag-filter active" : "tag-filter"}
            type="button"
            key={tag.slug}
            onClick={() => selectArticleTag(tag.slug)}
            disabled={loading || loadingMore}
          >
            {tag.name}
            <span>{loading && selectedTag === tag.slug ? <ButtonSpinner /> : tag.count ?? 0}</span>
          </button>
        ))}
        {untaggedArticleTotal > 0 && (
          <button
            className={
              selectedTag === untaggedArticleFilter ? "tag-filter untagged active" : "tag-filter untagged"
            }
            type="button"
            onClick={() => selectArticleTag(untaggedArticleFilter)}
            disabled={loading || loadingMore}
          >
            无标签文章
            <span>
              {loading && selectedTag === untaggedArticleFilter ? <ButtonSpinner /> : untaggedArticleTotal}
            </span>
          </button>
        )}
        {authenticated && (
          <button
            className={showingTrash ? "tag-filter trash active" : "tag-filter trash"}
            type="button"
            onClick={() => void showTrash()}
            disabled={trashDisabled}
          >
            回收站
            <span>{trashLoading && showingTrash ? <ButtonSpinner /> : deletedArticleTotal}</span>
          </button>
        )}
      </section>
    </aside>
  );
}
