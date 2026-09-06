import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { listArticles, listTags, searchArticles } from "../api";
import type { ArticleSummary, Tag as TagType } from "../types";
import { asErrorMessage } from "../utils";

const firstArticlePage = 1; // 文章列表的初始页码。
const searchDebounceMs = 650; // 访客输入时发起查询前的延迟。
export const minAutoSearchLength = 2; // 单字符输入仅在本地处理，以节省 Cloudflare 请求。
export const untaggedArticleFilter = "__untagged__"; // 用于筛选无标签文章的保留 API 值。

/** 管理文章列表的筛选、防抖查询、标签计数和滚动分页。 */
export function useArticleList({ active, contentAreaRef, onError: setError }: {
  active: boolean;
  contentAreaRef: RefObject<HTMLElement | null>;
  onError: (message: string) => void;
}) {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [tags, setTags] = useState<TagType[]>([]);
  const [tagOptions, setTagOptions] = useState<TagType[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [articlePage, setArticlePage] = useState(firstArticlePage);
  const [articleTotal, setArticleTotal] = useState(0);
  const [allArticleTotal, setAllArticleTotal] = useState(0);
  const [untaggedArticleTotal, setUntaggedArticleTotal] = useState(0);
  const [hasMoreArticles, setHasMoreArticles] = useState(false);
  const articleRequestId = useRef(0);
  const articleSearchEffectReady = useRef(false);

  const selectedTagName = useMemo(
    () => selectedTag === untaggedArticleFilter ? "无标签文章" : tags.find((tag) => tag.slug === selectedTag)?.name ?? "",
    [selectedTag, tags]
  );

  const effectiveSearch = useMemo(() => search.trim(), [search]);

  const canApplySearch = effectiveSearch.length === 0 || effectiveSearch.length >= minAutoSearchLength;

  /** 刷新搜索结果和标签计数，并忽略旧查询迟到的结果。 */
  const refreshContent = useCallback(async () => {
    const requestId = articleRequestId.current + 1;
    articleRequestId.current = requestId;
    setLoading(true);
    setLoadingMore(false);
    try {
      const result = await searchArticles({ page: firstArticlePage, search: appliedSearch, tag: selectedTag });
      if (requestId !== articleRequestId.current) {
        return;
      }
      const articleResult = result.articleResult;
      setArticles(articleResult.articles);
      setArticlePage(articleResult.page);
      setArticleTotal(articleResult.total);
      setAllArticleTotal(result.allArticleTotal);
      setUntaggedArticleTotal(result.untaggedArticleTotal);
      setHasMoreArticles(articleResult.hasMore);
      setTags(result.tags);
      if (selectedTag && selectedTag !== untaggedArticleFilter && !result.tags.some((tag) => tag.slug === selectedTag)) {
        setSelectedTag("");
      }
      if (!appliedSearch) {
        setTagOptions(result.tags);
      }
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      if (requestId === articleRequestId.current) {
        setLoading(false);
      }
    }
  }, [appliedSearch, selectedTag, setError]);

  /** 追加当前查询的下一页，并保留请求所属的筛选条件。 */
  const loadMoreArticles = useCallback(async () => {
    if (loading || loadingMore || !hasMoreArticles) {
      return;
    }

    const nextPage = articlePage + 1; // 无限加载请求的下一页页码。
    const requestId = articleRequestId.current;
    setLoadingMore(true);
    try {
      const articleResult = await listArticles({ page: nextPage, search: appliedSearch, tag: selectedTag });
      if (requestId !== articleRequestId.current) {
        return;
      }
      setArticles((currentArticles) => [...currentArticles, ...articleResult.articles]);
      setArticlePage(articleResult.page);
      setArticleTotal(articleResult.total);
      setHasMoreArticles(articleResult.hasMore);
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      if (requestId === articleRequestId.current) {
        setLoadingMore(false);
      }
    }
  }, [appliedSearch, articlePage, hasMoreArticles, loading, loadingMore, selectedTag, setError]);

  useEffect(() => {
    if (!canApplySearch) {
      return;
    }

    const timer = window.setTimeout(() => {
      setAppliedSearch(effectiveSearch);
    }, searchDebounceMs);

    return () => window.clearTimeout(timer);
  }, [canApplySearch, effectiveSearch]);

  useEffect(() => {
    if (!articleSearchEffectReady.current) {
      articleSearchEffectReady.current = true;
      return;
    }

    void refreshContent();
  }, [refreshContent]);

  useEffect(() => {
    if (!active || !hasMoreArticles || loading || loadingMore) {
      return;
    }

    const handleScroll = () => {
      const scrollElement = contentAreaRef.current; // 桌面端列表页中文章栏的滚动容器。
      const usesWindowScroll = !scrollElement || scrollElement.scrollHeight <= scrollElement.clientHeight + 1;
      const scrollTop = usesWindowScroll ? window.scrollY : scrollElement.scrollTop; // 当前滚动偏移量。
      const viewportHeight = usesWindowScroll ? window.innerHeight : scrollElement.clientHeight; // 可见的滚动视口高度。
      const scrollHeight = usesWindowScroll ? document.documentElement.scrollHeight : scrollElement.scrollHeight; // 可滚动的总高度。
      const scrollBottom = scrollTop + viewportHeight;
      const triggerLine = scrollHeight - 360; // 距底部多远时触发加载更多。

      if (scrollBottom >= triggerLine) {
        void loadMoreArticles();
      }
    };

    const scrollElement = contentAreaRef.current;
    scrollElement?.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      scrollElement?.removeEventListener("scroll", handleScroll);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [hasMoreArticles, loadMoreArticles, loading, loadingMore, active, contentAreaRef]);

  /** 刷新编辑器可选标签，不受当前文章搜索条件影响。 */
  async function refreshTagOptions() {
    const result = await listTags();
    setTagOptions(result.tags);
  }

  return {
    articles, setArticles, tags, tagOptions, selectedTag, setSelectedTag,
    search, setSearch, appliedSearch, effectiveSearch, selectedTagName,
    loading, setLoading, loadingMore, allArticleTotal, untaggedArticleTotal,
    hasMoreArticles, refreshContent, refreshTagOptions
  };
}
