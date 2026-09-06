import { useState } from "react";
import { listDeletedArticles, permanentlyDeleteArticle, restoreArticle } from "../api";
import type { ArticleSummary } from "../types";
import { asErrorMessage } from "../utils";

const firstArticlePage = 1; // 回收站列表的初始页码。

/** 管理管理员回收站的分页、恢复和永久删除操作。 */
export function useArticleTrash({ refreshContent, onError: setError, onMessage: setMessage }: {
  refreshContent: () => Promise<void>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}) {
  const [deletedArticles, setDeletedArticles] = useState<ArticleSummary[]>([]);
  const [deletedArticlePage, setDeletedArticlePage] = useState(firstArticlePage);
  const [deletedArticleTotal, setDeletedArticleTotal] = useState(0);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashLoadingMore, setTrashLoadingMore] = useState(false);
  const [trashArticleAction, setTrashArticleAction] = useState("");
  const [hasMoreDeletedArticles, setHasMoreDeletedArticles] = useState(false);

  /** 刷新仅管理员可见的已删除文章的第一页。 */
  async function refreshDeletedArticles() {
    setTrashLoading(true);
    setTrashLoadingMore(false);
    try {
      const result = await listDeletedArticles({ page: firstArticlePage });
      setDeletedArticles(result.articles);
      setDeletedArticlePage(result.page);
      setDeletedArticleTotal(result.total);
      setHasMoreDeletedArticles(result.hasMore);
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      setTrashLoading(false);
    }
  }

  /** 当回收站还有更多记录时，加载下一页已删除文章。 */
  async function loadMoreDeletedArticles() {
    if (trashLoading || trashLoadingMore || !hasMoreDeletedArticles) {
      return;
    }

    const nextPage = deletedArticlePage + 1; // 管理员请求的回收站下一页页码。
    setTrashLoadingMore(true);
    try {
      const result = await listDeletedArticles({ page: nextPage });
      setDeletedArticles((currentArticles) => [...currentArticles, ...result.articles]);
      setDeletedArticlePage(result.page);
      setDeletedArticleTotal(result.total);
      setHasMoreDeletedArticles(result.hasMore);
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      setTrashLoadingMore(false);
    }
  }

  /** 将一篇文章从回收站恢复到正常列表。 */
  async function restoreDeletedArticle(slug: string) {
    const actionKey = `restore-${slug}`; // 恢复文章的按钮级动作键。
    setTrashArticleAction(actionKey);
    setError("");
    try {
      await restoreArticle(slug);
      setMessage("文章已恢复");
      await Promise.all([refreshDeletedArticles(), refreshContent()]);
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      setTrashArticleAction("");
    }
  }

  /** 从回收站永久删除一篇文章。 */
  async function permanentlyDeleteDeletedArticle(slug: string) {
    if (!window.confirm("确定永久删除这篇文章吗？这个操作无法撤销。")) {
      return;
    }

    const actionKey = `permanent-${slug}`; // 不可逆删除的按钮级动作键。
    setTrashArticleAction(actionKey);
    setError("");
    try {
      await permanentlyDeleteArticle(slug);
      setMessage("文章已永久删除");
      await refreshDeletedArticles();
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      setTrashArticleAction("");
    }
  }

  /** 在退出管理员状态时清空回收站列表与计数。 */
  function clearDeletedArticles() {
    setDeletedArticles([]);
    setDeletedArticleTotal(0);
  }

  return {
    deletedArticles, deletedArticleTotal, trashLoading, trashLoadingMore,
    trashArticleAction, hasMoreDeletedArticles, refreshDeletedArticles,
    loadMoreDeletedArticles, restoreDeletedArticle, permanentlyDeleteDeletedArticle,
    clearDeletedArticles
  };
}
