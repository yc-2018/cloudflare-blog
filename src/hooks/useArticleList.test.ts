// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleSearchResponse } from "../types";
import { useArticleList } from "./useArticleList";

const api = vi.hoisted(() => ({
  listArticles: vi.fn(),
  listTags: vi.fn(),
  searchArticles: vi.fn()
}));

vi.mock("../api", () => api);

/** 构建可辨认的搜索结果，用于检查异步查询是否覆盖当前列表。 */
function searchResult(title: string): ArticleSearchResponse {
  return {
    articleResult: {
      articles: [{
        id: 1, slug: title, title, excerpt: "", coverImageUrl: "", visibility: "public",
        viewCount: 0, createdAt: "2026-09-06", updatedAt: "2026-09-06", tags: []
      }],
      page: 1, limit: 10, total: 1, hasMore: false
    },
    allArticleTotal: 1,
    untaggedArticleTotal: 1,
    tags: []
  };
}

/** 使用稳定的错误回调和滚动容器测试列表状态。 */
function renderArticleList() {
  const onError = vi.fn();
  const contentAreaRef = { current: null };
  return renderHook(() => useArticleList({ active: false, contentAreaRef, onError }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  api.searchArticles.mockResolvedValue(searchResult("搜索结果"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useArticleList search lifecycle", () => {
  it("waits for two characters and debounces a completed query", async () => {
    const { result } = renderArticleList();

    act(() => result.current.setSearch("博"));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(api.searchArticles).not.toHaveBeenCalled();

    act(() => result.current.setSearch("博客"));
    await act(async () => vi.advanceTimersByTimeAsync(400));
    act(() => result.current.setSearch(" 博客文章 "));
    await act(async () => vi.advanceTimersByTimeAsync(649));
    expect(api.searchArticles).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(api.searchArticles).toHaveBeenCalledExactlyOnceWith({ page: 1, search: "博客文章", tag: "" });
  });

  it("keeps the newer query when an older request finishes later", async () => {
    let resolveOlder!: (value: ArticleSearchResponse) => void;
    api.searchArticles.mockReturnValueOnce(new Promise<ArticleSearchResponse>((resolve) => { resolveOlder = resolve; }));
    api.searchArticles.mockResolvedValueOnce(searchResult("最新结果"));
    const { result } = renderArticleList();

    act(() => { void result.current.refreshContent(); });
    act(() => result.current.setSearch("最新"));
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(result.current.articles[0].title).toBe("最新结果");

    await act(async () => resolveOlder(searchResult("过期结果")));
    expect(result.current.articles[0].title).toBe("最新结果");
    expect(result.current.loading).toBe(false);
  });
});
