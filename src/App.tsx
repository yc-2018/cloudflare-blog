import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { remarkHighlightMark } from "remark-highlight-mark";
import {
  ArrowLeft,
  Archive,
  BarChart3,
  MessageSquareText,
  Eye,
  EyeOff,
  FilePenLine,
  ImageIcon,
  Lock,
  LogIn,
  LogOut,
  Copy,
  Check,
  Plus,
  Pin,
  Search,
  Share2,
  TagIcon,
  Tag,
  Trash2,
  X
} from "lucide-react";
import {
  createArticle,
  createMessage,
  deleteArticle,
  deleteMessage,
  getArticle,
  getMessageCaptcha,
  getMe,
  listArticles,
  listDeletedArticles,
  listMessages,
  listTags,
  login,
  logout,
  permanentlyDeleteArticle,
  restoreArticle,
  searchArticles,
  toggleArticlePinned,
  updateArticle,
  updateMessageStatus,
  ApiRequestError
} from "./api";
import type {
  Article,
  ArticleInput,
  ArticleSummary,
  GuestbookCaptcha,
  GuestbookInput,
  GuestbookMessage,
  Tag as TagType,
  Visibility
} from "./types";
import {
  articleToInput,
  emptyArticleInput,
  formatArticleTimeTitle,
  formatDate,
  formatDateTime,
  sampleMarkdown
} from "./utils";
import {
  convertStandaloneImageLinks,
  imageHostLabels,
  markdownImage,
  prepareImageForUpload,
  uploadImageWithFallback
} from "./imageUpload";
import { ArticleViewCount } from "./ArticleViewCount";
import { StatisticsPage } from "./StatisticsPage";
import type { Options as RehypeSanitizeOptions } from "rehype-sanitize";

type View = "list" | "article" | "editor" | "guestbook" | "statistics" | "trash";
interface PasswordPromptState {
  slug: string;
  value: string;
  error: string;
}
const firstArticlePage = 1; // Initial article list page.
const siteTitle = "仰晨博客"; // Browser title used outside article pages.
const guestbookPath = "/guestbook"; // Shareable path for the guestbook page.
const statisticsPath = "/statistics"; // Shareable path for administrator visit statistics.
const trashPath = "/trash"; // Shareable path for the administrator article recycle bin.
const searchDebounceMs = 650; // Delay before querying as the visitor types.
const minAutoSearchLength = 2; // One-character input stays local to save Cloudflare requests.
const guestbookCooldownKey = "guestbook:lastSentAt"; // Local storage key for client-side guest cooldown.
const guestbookPendingKey = "guestbook:pending"; // Local storage key for visitor messages awaiting moderation.
const passwordQueryKey = "password"; // URL query key used by password article share links.
const untaggedArticleFilter = "__untagged__"; // Reserved API filter for articles that have no tags.
const adminDefaultNickname = "仰晨"; // Initial nickname shown to administrators when writing messages.
const minLightboxScale = 0.5; // Smallest image scale allowed in the lightbox.
const maxLightboxScale = 4; // Largest image scale allowed in the lightbox.
const lightboxScaleStep = 0.001; // Scale change applied to each wheel delta unit.
const lightboxDragThreshold = 4; // Pointer movement in pixels required before a click becomes a drag.

const markdownSanitizeSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: Array.from(
    new Set([...(defaultSchema.tagNames ?? []), "abbr", "figcaption", "figure", "kbd", "mark", "small", "u"])
  )
};
const commentMarkdownElements = [
  "p",
  "a",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "img",
  "br"
]; // Lightweight Markdown elements allowed in public comments and replies.
const guestbookCooldownSeconds = 120; // Seconds a guest must wait before sending again.
const defaultGuestbookDraft: GuestbookInput = {
  nickname: "",
  email: "",
  content: "",
  parentId: null,
  captchaToken: "",
  captchaAnswer: ""
};

function articlePath(slug: string) {
  return `/articles/${encodeURIComponent(slug)}`;
}

function slugFromPath(pathname: string) {
  const match = pathname.match(/^\/articles\/(.+)$/);
  if (!match) {
    return "";
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

export function App() {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [deletedArticles, setDeletedArticles] = useState<ArticleSummary[]>([]);
  const [tags, setTags] = useState<TagType[]>([]);
  const [tagOptions, setTagOptions] = useState<TagType[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<ArticleInput>({ ...emptyArticleInput, content: sampleMarkdown() });
  const [view, setView] = useState<View>("list");
  const [authenticated, setAuthenticated] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPromptState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [articlePage, setArticlePage] = useState(firstArticlePage);
  const [deletedArticlePage, setDeletedArticlePage] = useState(firstArticlePage);
  const [articleTotal, setArticleTotal] = useState(0);
  const [allArticleTotal, setAllArticleTotal] = useState(0);
  const [deletedArticleTotal, setDeletedArticleTotal] = useState(0);
  const [untaggedArticleTotal, setUntaggedArticleTotal] = useState(0);
  const [hasMoreArticles, setHasMoreArticles] = useState(false);
  const [guestbookMessages, setGuestbookMessages] = useState<GuestbookMessage[]>([]);
  const [guestbookDraft, setGuestbookDraft] = useState<GuestbookInput>(defaultGuestbookDraft);
  const [guestbookCaptcha, setGuestbookCaptcha] = useState<GuestbookCaptcha | null>(null);
  const [guestbookReplyTarget, setGuestbookReplyTarget] = useState<GuestbookMessage | null>(null);
  const [guestbookLoading, setGuestbookLoading] = useState(false);
  const [guestbookSubmitting, setGuestbookSubmitting] = useState(false);
  const [guestbookCaptchaRefreshing, setGuestbookCaptchaRefreshing] = useState(false);
  const [guestbookAction, setGuestbookAction] = useState("");
  const [guestbookCooldown, setGuestbookCooldown] = useState(0);
  const [articleSubmitting, setArticleSubmitting] = useState(false);
  const [articleDeleting, setArticleDeleting] = useState(false);
  const [articleDeletingSlug, setArticleDeletingSlug] = useState("");
  const [articlePinningSlug, setArticlePinningSlug] = useState("");
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashLoadingMore, setTrashLoadingMore] = useState(false);
  const [trashArticleAction, setTrashArticleAction] = useState("");
  const [hasMoreDeletedArticles, setHasMoreDeletedArticles] = useState(false);
  const [editingArticleSlug, setEditingArticleSlug] = useState("");
  const [routeAction, setRouteAction] = useState("");
  const [authAction, setAuthAction] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const articleRequestId = useRef(0);
  const contentAreaRef = useRef<HTMLElement | null>(null);
  const articleSearchEffectReady = useRef(false);
  const listScrollY = useRef(0);
  const articleSubmittingRef = useRef(false);
  const articleDeletingRef = useRef(false);
  const guestbookSubmittingRef = useRef(false);
  const guestbookActionRef = useRef("");
  const guestbookCaptchaRefreshingRef = useRef(false);
  const messageScopeRef = useRef<string>("guestbook");
  const messageRequestIdRef = useRef(0);
  const routeActionRef = useRef("");
  const routeActionOwnerRef = useRef(0);
  const authActionRef = useRef("");
  const articleOpenRequestId = useRef(0);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      void syncViewFromLocation();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [authenticated]);

  useEffect(() => {
    document.title =
      view === "article" && activeArticle
        ? `${siteTitle} - ${activeArticle.title}`
        : view === "guestbook"
          ? `${siteTitle} - 留言板`
          : view === "statistics"
            ? `${siteTitle} - 访问统计`
            : view === "trash"
              ? `${siteTitle} - 回收站`
            : siteTitle;
  }, [activeArticle, view]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timer = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const selectedTagName = useMemo(
    () => selectedTag === untaggedArticleFilter ? "无标签文章" : tags.find((tag) => tag.slug === selectedTag)?.name ?? "",
    [selectedTag, tags]
  );
  const effectiveSearch = useMemo(() => search.trim(), [search]);
  const canApplySearch = effectiveSearch.length === 0 || effectiveSearch.length >= minAutoSearchLength;

  useEffect(() => {
    const updateCooldown = () => {
      setGuestbookCooldown(readGuestbookCooldown());
    };

    updateCooldown();
    const timer = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (view === "guestbook") {
      void refreshGuestbook();
    } else if (view === "article" && activeArticle) {
      void refreshGuestbook(activeArticle.id, currentArticlePassword(activeArticle.id));
    }
  }, [authenticated, view, activeArticle?.id]);

  useEffect(() => {
    if (!authenticated) {
      setDeletedArticles([]);
      setDeletedArticleTotal(0);
      if (view === "trash") {
        showList();
      }
      return;
    }
  }, [authenticated, view]);

  async function bootstrap() {
    setLoading(true);
    try {
      const me = await getMe();
      setAuthenticated(me.authenticated);
      await refreshContent();
      if (me.authenticated && window.location.pathname !== trashPath) {
        await refreshDeletedArticles();
      }
      await syncViewFromLocation(me.authenticated);
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function syncViewFromLocation(authenticatedOverride = authenticated) {
    if (window.location.pathname === statisticsPath) {
      invalidateArticleOpenRequest();
      setActiveArticle(null);
      setEditingSlug(null);
      setPasswordPrompt(null);
      setView("statistics");
      return;
    }

    if (window.location.pathname === trashPath) {
      invalidateArticleOpenRequest();
      setActiveArticle(null);
      setEditingSlug(null);
      setPasswordPrompt(null);
      if (!authenticatedOverride) {
        setLoginOpen(true);
        setView("list");
        return;
      }

      setView("trash");
      await refreshDeletedArticles();
      return;
    }

    if (window.location.pathname === guestbookPath) {
      invalidateArticleOpenRequest();
      setActiveArticle(null);
      setEditingSlug(null);
      setPasswordPrompt(null);
      setView("guestbook");
      return;
    }

    const slug = slugFromPath(window.location.pathname);
    if (!slug) {
      invalidateArticleOpenRequest();
      setActiveArticle(null);
      setEditingSlug(null);
      setPasswordPrompt(null);
      setView("list");
      return;
    }

    invalidateArticleOpenRequest();
    const routeParams = new URLSearchParams(window.location.search); // Current article route query values.
    const includeDeleted = routeParams.get("deleted") === "1"; // Whether this route targets an article in the recycle bin.
    if (includeDeleted && !authenticatedOverride) {
      setLoginOpen(true);
      setView("list");
      return;
    }

    await loadArticle(slug, false, routeParams.get(passwordQueryKey) ?? "", includeDeleted);
  }

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
  }, [appliedSearch, selectedTag]);

  const loadMoreArticles = useCallback(async () => {
    if (loading || loadingMore || !hasMoreArticles) {
      return;
    }

    const nextPage = articlePage + 1; // Next page requested for infinite loading.
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
  }, [appliedSearch, articlePage, hasMoreArticles, loading, loadingMore, selectedTag]);

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
    if (view !== "list" || !hasMoreArticles || loading || loadingMore) {
      return;
    }

    const handleScroll = () => {
      const scrollElement = contentAreaRef.current; // Article column scroll container on desktop list pages.
      const usesWindowScroll = !scrollElement || scrollElement.scrollHeight <= scrollElement.clientHeight + 1;
      const scrollTop = usesWindowScroll ? window.scrollY : scrollElement.scrollTop; // Current scroll offset.
      const viewportHeight = usesWindowScroll ? window.innerHeight : scrollElement.clientHeight; // Visible scroll viewport.
      const scrollHeight = usesWindowScroll ? document.documentElement.scrollHeight : scrollElement.scrollHeight; // Total scrollable height.
      const scrollBottom = scrollTop + viewportHeight;
      const triggerLine = scrollHeight - 360; // Distance from bottom before loading more.

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
  }, [hasMoreArticles, loadMoreArticles, loading, loadingMore, view]);

  async function refreshTagOptions() {
    const result = await listTags();
    setTagOptions(result.tags);
  }

  /** Refreshes the first page of administrator-only deleted articles. */
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

  /** Loads another page of deleted articles when the recycle bin has more rows. */
  async function loadMoreDeletedArticles() {
    if (trashLoading || trashLoadingMore || !hasMoreDeletedArticles) {
      return;
    }

    const nextPage = deletedArticlePage + 1; // Next recycle-bin page requested by the administrator.
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

  async function openArticle(slug: string) {
    if (routeActionRef.current) {
      return;
    }

    const actionKey = `article-${slug}`; // Display key for this article request.
    const actionOwner = beginRouteAction(actionKey); // Unique owner for this invocation.
    const scrollElement = contentAreaRef.current;
    listScrollY.current = scrollElement && scrollElement.scrollHeight > scrollElement.clientHeight + 1 ? scrollElement.scrollTop : window.scrollY;
    try {
      await loadArticle(slug, true);
    } finally {
      releaseRouteAction(actionOwner, actionKey);
    }
  }

  /** Loads an article and moves the single-page app into article view. */
  async function loadArticle(slug: string, pushUrl: boolean, password = "", includeDeleted = false) {
    const requestId = articleOpenRequestId.current + 1; // Request allowed to commit the next article route state.
    articleOpenRequestId.current = requestId;
    setError("");
    setLoading(true);
    try {
      const result = await getArticle(slug, password, includeDeleted);
      if (requestId !== articleOpenRequestId.current) {
        return;
      }

      setArticles((currentArticles) =>
        currentArticles.map((article) =>
          article.slug === result.article.slug ? { ...article, viewCount: result.article.viewCount } : article
        )
      );
      setActiveArticle(result.article);
      setPasswordPrompt(null);
      setView("article");
      if (pushUrl) {
        const nextUrl = new URL(articlePath(result.article.slug), window.location.origin);
        if (password && result.article.visibility === "password") {
          nextUrl.searchParams.set(passwordQueryKey, password);
        }
        if (includeDeleted) {
          nextUrl.searchParams.set("deleted", "1");
        }
        if (window.location.pathname + window.location.search !== nextUrl.pathname + nextUrl.search) {
          window.history.pushState(null, "", `${nextUrl.pathname}${nextUrl.search}`);
        }
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      if (requestId !== articleOpenRequestId.current) {
        return;
      }

      if (caught instanceof ApiRequestError && ["PASSWORD_REQUIRED", "INVALID_PASSWORD", "RATE_LIMIT"].includes(caught.code)) {
        setPasswordPrompt({ slug, value: password, error: caught.message });
        setError("");
      } else {
        setError(asErrorMessage(caught));
        setLoginOpen(!authenticated);
      }
      if (!pushUrl) {
        setView("list");
      }
    } finally {
      if (requestId === articleOpenRequestId.current) {
        setLoading(false);
      }
    }
  }

  /** Opens a recycled article for administrator read-only viewing. */
  async function openDeletedArticle(slug: string) {
    if (routeActionRef.current) {
      return;
    }

    const actionKey = `deleted-article-${slug}`; // Display key for this recycled article request.
    const actionOwner = beginRouteAction(actionKey); // Unique owner for this invocation.
    try {
      await loadArticle(slug, true, "", true);
    } finally {
      releaseRouteAction(actionOwner, actionKey);
    }
  }

  /** Starts one uniquely owned asynchronous route action while retaining its display key. */
  function beginRouteAction(actionKey: string) {
    const owner = routeActionOwnerRef.current + 1; // Monotonic identity distinct from reusable display keys.
    routeActionOwnerRef.current = owner;
    routeActionRef.current = actionKey;
    setRouteAction(actionKey);
    return owner;
  }

  /** Releases a route action only when the completing operation still owns it. */
  function releaseRouteAction(owner: number, actionKey: string) {
    if (routeActionOwnerRef.current !== owner || routeActionRef.current !== actionKey) {
      return;
    }

    routeActionOwnerRef.current += 1;
    routeActionRef.current = "";
    setRouteAction("");
  }

  /** Prevents in-flight article and route actions from replacing a newer transition. */
  function invalidateArticleOpenRequest() {
    articleOpenRequestId.current += 1;
    routeActionOwnerRef.current += 1;
    if (routeActionRef.current) {
      routeActionRef.current = "";
      setRouteAction("");
    }
    setEditingArticleSlug("");
    setLoading(false);
  }

  function showList(options: { restoreScroll?: boolean } = {}) {
    invalidateArticleOpenRequest();
    setActiveArticle(null);
    setEditingSlug(null);
    setView("list");
    setPasswordPrompt(null);
    if (window.location.pathname !== "/") {
      window.history.pushState(null, "", "/");
    }
    window.requestAnimationFrame(() => {
      const scrollTop = options.restoreScroll ? listScrollY.current : 0; // Stored article-column scroll position.
      if (contentAreaRef.current && contentAreaRef.current.scrollHeight > contentAreaRef.current.clientHeight + 1) {
        contentAreaRef.current.scrollTop = scrollTop;
      } else {
        window.scrollTo({ top: scrollTop, behavior: "auto" });
      }
    });
  }

  /** Returns from the recycle bin or detail views before applying an article-list tag filter. */
  function selectArticleTag(tagSlug: string) {
    showList();
    setSelectedTag(tagSlug);
  }

  /** Opens the administrator article recycle bin and refreshes its first page. */
  async function showTrash(pushUrl = true) {
    if (routeActionRef.current || !authenticated) {
      return;
    }

    invalidateArticleOpenRequest();
    const actionKey = "trash"; // Display key for the recycle-bin refresh.
    const actionOwner = beginRouteAction(actionKey); // Unique owner for this invocation.
    setActiveArticle(null);
    setEditingSlug(null);
    setPasswordPrompt(null);
    setView("trash");
    if (pushUrl && window.location.pathname !== trashPath) {
      window.history.pushState(null, "", trashPath);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      await refreshDeletedArticles();
    } finally {
      releaseRouteAction(actionOwner, actionKey);
    }
  }

  /** Restores one article from the recycle bin back to the normal list. */
  async function restoreDeletedArticle(slug: string) {
    const actionKey = `restore-${slug}`; // Button-level action key for restoring an article.
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

  /** Permanently deletes one article from the recycle bin. */
  async function permanentlyDeleteDeletedArticle(slug: string) {
    if (!window.confirm("确定永久删除这篇文章吗？这个操作无法撤销。")) {
      return;
    }

    const actionKey = `permanent-${slug}`; // Button-level action key for irreversible deletion.
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

  /** Opens the shareable guestbook view and refreshes its current messages. */
  async function showGuestbook(pushUrl = true) {
    if (routeActionRef.current) {
      return;
    }

    invalidateArticleOpenRequest();
    const actionKey = "guestbook"; // Display key for this guestbook refresh.
    const actionOwner = beginRouteAction(actionKey); // Unique owner for this invocation.
    setActiveArticle(null);
    setEditingSlug(null);
    setPasswordPrompt(null);
    setView("guestbook");
    if (pushUrl && window.location.pathname !== guestbookPath) {
      window.history.pushState(null, "", guestbookPath);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      await refreshGuestbook();
    } finally {
      releaseRouteAction(actionOwner, actionKey);
    }
  }

  /** Opens administrator visit statistics while preserving a direct, shareable route. */
  function showStatistics(pushUrl = true) {
    if (routeActionRef.current) {
      return;
    }

    invalidateArticleOpenRequest();
    setActiveArticle(null);
    setEditingSlug(null);
    setPasswordPrompt(null);
    setView("statistics");
    if (pushUrl && window.location.pathname + window.location.search !== statisticsPath) {
      window.history.pushState(null, "", statisticsPath);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function newArticle() {
    if (routeActionRef.current) {
      return;
    }

    invalidateArticleOpenRequest();
    const actionKey = "new-article"; // Display key for this editor preparation.
    const actionOwner = beginRouteAction(actionKey); // Unique owner for this invocation.
    setEditingSlug(null);
    setDraft({ ...emptyArticleInput, content: sampleMarkdown() });
    setActiveArticle(null);
    void refreshTagOptions()
      .catch((caught) => {
        if (routeActionOwnerRef.current === actionOwner) {
          setError(asErrorMessage(caught));
        }
      })
      .finally(() => {
        releaseRouteAction(actionOwner, actionKey);
      });
    setView("editor");
    if (window.location.pathname !== "/") {
      window.history.pushState(null, "", "/");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function editArticle(slug: string) {
    if (editingArticleSlug) {
      return;
    }

    invalidateArticleOpenRequest();
    const actionOwner = routeActionOwnerRef.current + 1; // Unique owner for this editor-loading invocation.
    routeActionOwnerRef.current = actionOwner;
    setError("");
    setLoading(true);
    setEditingArticleSlug(slug);
    try {
      const result = await getArticle(slug);
      if (routeActionOwnerRef.current !== actionOwner) {
        return;
      }

      setEditingSlug(slug);
      setActiveArticle(result.article);
      setDraft(articleToInput(result.article));
      await refreshTagOptions();
      if (routeActionOwnerRef.current !== actionOwner) {
        return;
      }

      setView("editor");
      if (window.location.pathname !== articlePath(result.article.slug)) {
        window.history.pushState(null, "", articlePath(result.article.slug));
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      if (routeActionOwnerRef.current === actionOwner) {
        setError(asErrorMessage(caught));
      }
    } finally {
      if (routeActionOwnerRef.current === actionOwner) {
        routeActionOwnerRef.current += 1;
        setLoading(false);
        setEditingArticleSlug("");
      }
    }
  }

  /** Copies an article title and its current URL, retaining a password query when needed. */
  async function shareArticle() {
    if (!activeArticle) {
      return;
    }

    const shareUrl = new URL(articlePath(activeArticle.slug), window.location.origin);
    const currentPassword = new URLSearchParams(window.location.search).get(passwordQueryKey) ?? activeArticle.accessPassword ?? "";
    if (activeArticle.visibility === "password" && currentPassword) {
      shareUrl.searchParams.set(passwordQueryKey, currentPassword);
    }
    if (activeArticle.deletedAt) {
      shareUrl.searchParams.set("deleted", "1");
    }

    try {
      await navigator.clipboard.writeText(`${activeArticle.title}\n${shareUrl.toString()}`);
      setNotice("分享内容已复制");
    } catch {
      setError("复制失败，请检查浏览器剪贴板权限");
    }
  }

  /** Tries the password currently entered in the unlock dialog. */
  async function submitArticlePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordPrompt) {
      return;
    }

    await loadArticle(passwordPrompt.slug, true, passwordPrompt.value);
  }

  async function submitDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (articleSubmittingRef.current) {
      return;
    }

    articleSubmittingRef.current = true;
    setArticleSubmitting(true);
    setError("");
    setMessage("");

    try {
      const result = editingSlug ? await updateArticle(editingSlug, draft) : await createArticle(draft);
      setMessage(editingSlug ? "文章已更新" : "文章已发布");
      setActiveArticle(result.article);
      setEditingSlug(result.article.slug);
      setDraft(articleToInput(result.article));
      setView("article");
      window.history.pushState(null, "", articlePath(result.article.slug));
      await refreshContent();
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      articleSubmittingRef.current = false;
      setArticleSubmitting(false);
    }
  }

  async function removeArticle(slug: string) {
    if (articleDeletingRef.current) {
      return;
    }

    if (!window.confirm("确定将这篇文章移入回收站吗？")) {
      return;
    }

    articleDeletingRef.current = true;
    setArticleDeleting(true);
    setArticleDeletingSlug(slug);
    setError("");
    try {
      await deleteArticle(slug);
      setMessage("文章已移入回收站");
      if (activeArticle?.slug === slug) {
        setActiveArticle(null);
        showList();
      }
      await Promise.all([refreshContent(), authenticated ? refreshDeletedArticles() : Promise.resolve()]);
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      articleDeletingRef.current = false;
      setArticleDeleting(false);
      setArticleDeletingSlug("");
    }
  }

  /** Toggles an article's pinned state and refreshes the current list ordering. */
  async function changeArticlePinned(slug: string, pinned: boolean) {
    if (articlePinningSlug) {
      return;
    }
    setArticlePinningSlug(slug);
    setError("");
    try {
      await toggleArticlePinned(slug, pinned);
      setMessage(pinned ? "文章已置顶" : "文章已取消置顶");
      await refreshContent();
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      setArticlePinningSlug("");
    }
  }

  async function handleLogin(username: string, password: string) {
    setError("");
    await login(username, password);
    setAuthenticated(true);
    setLoginOpen(false);
    setMessage("已登录");
    await Promise.all([refreshContent(), refreshDeletedArticles()]);
  }

  async function handleLogout() {
    if (authActionRef.current) {
      return;
    }

    authActionRef.current = "logout";
    setAuthAction("logout");
    setError("");
    try {
      await logout();
      setAuthenticated(false);
      setGuestbookDraft(defaultGuestbookDraft);
      setActiveArticle(null);
      setEditingSlug(null);
      setDeletedArticles([]);
      setDeletedArticleTotal(0);
      showList();
      setMessage("已退出登录");
      await refreshContent();
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      authActionRef.current = "";
      setAuthAction("");
    }
  }

  /** Reloads guestbook messages and prepares captcha state for the current viewer. */
  async function refreshGuestbook(articleId: number | null = null, password = "") {
    const scope = articleId === null ? "guestbook" : `article-${articleId}`;
    const requestId = messageRequestIdRef.current + 1;
    messageRequestIdRef.current = requestId;
    if (messageScopeRef.current !== scope) {
      messageScopeRef.current = scope;
      setGuestbookMessages([]);
      setGuestbookReplyTarget(null);
      setGuestbookDraft((currentDraft) => ({ ...currentDraft, parentId: null }));
    }
    setGuestbookLoading(true);
    try {
      const pending = readPendingGuestbookMessages(scope);
      const pendingIds = pending.map((item) => item.message.id);
      const result = pendingIds.length ? await listMessages(articleId, password, pendingIds) : await listMessages(articleId, password);
      if (requestId !== messageRequestIdRef.current) return;
      const returnedIds = new Set(flattenGuestbookMessages(result.messages).map((item) => item.id));
      const approvedIds = new Set(flattenGuestbookMessages(result.messages).filter((item) => item.status === "approved").map((item) => item.id));
      writePendingGuestbookMessages(scope, readPendingGuestbookMessages(scope).filter((item) => returnedIds.has(item.message.id) && !approvedIds.has(item.message.id)));
      const retainedIds = new Set(readPendingGuestbookMessages(scope).map((item) => item.message.id));
      setGuestbookMessages(markLocalPendingMessages(result.messages, retainedIds));
      if (!authenticated) {
        const captchaResult = await getMessageCaptcha();
        if (requestId !== messageRequestIdRef.current) return;
        setGuestbookCaptcha(captchaResult.captcha);
        setGuestbookDraft((currentDraft) => ({ ...currentDraft, captchaToken: captchaResult.captcha.token, captchaAnswer: "" }));
      } else {
        setGuestbookCaptcha(null);
        setGuestbookDraft((currentDraft) => ({
          ...currentDraft,
          nickname: currentDraft.nickname || adminDefaultNickname,
          email: "",
          captchaToken: "",
          captchaAnswer: ""
        }));
      }
    } catch (caught) {
      if (requestId !== messageRequestIdRef.current) return;
      setError(asErrorMessage(caught));
    } finally {
      if (requestId === messageRequestIdRef.current) setGuestbookLoading(false);
    }
  }

  /** Requests a fresh captcha for guests after initial load or failed submission. */
  async function refreshGuestbookCaptcha() {
    if (authenticated || guestbookCaptchaRefreshingRef.current) {
      return;
    }

    guestbookCaptchaRefreshingRef.current = true;
    setGuestbookCaptchaRefreshing(true);
    try {
      const result = await getMessageCaptcha();
      setGuestbookCaptcha(result.captcha);
      setGuestbookDraft((currentDraft) => ({ ...currentDraft, captchaToken: result.captcha.token, captchaAnswer: "" }));
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      guestbookCaptchaRefreshingRef.current = false;
      setGuestbookCaptchaRefreshing(false);
    }
  }

  /** Sends a guestbook message or top-level reply from the shared form. */
  async function submitGuestbookMessage(event: React.FormEvent<HTMLFormElement>, articleId: number | null = null) {
    event.preventDefault();
    if (guestbookSubmittingRef.current) {
      return;
    }

    setError("");
    setMessage("");

    if (!authenticated && guestbookCooldown > 0) {
      setError(`发送太频繁了，请 ${guestbookCooldown} 秒后再试`);
      return;
    }

    guestbookSubmittingRef.current = true;
    setGuestbookSubmitting(true);
    try {
      const input = {
        ...guestbookDraft,
        nickname: guestbookDraft.nickname,
        parentId: guestbookReplyTarget?.id ?? null,
        articleId,
        articlePassword: articleId === null ? "" : currentArticlePassword(articleId),
        captchaToken: guestbookCaptcha?.token ?? guestbookDraft.captchaToken
      };
      const created = await createMessage(input);
      if (!authenticated) {
        window.localStorage.setItem(guestbookCooldownKey, String(Date.now()));
        setGuestbookCooldown(guestbookCooldownSeconds);
        addPendingGuestbookMessage(articleId === null ? "guestbook" : `article-${articleId}`, created.message);
      }
      setGuestbookDraft({
        ...defaultGuestbookDraft,
        nickname: guestbookDraft.nickname,
        email: authenticated ? "" : guestbookDraft.email
      });
      setGuestbookReplyTarget(null);
      setMessage(
        authenticated
          ? guestbookReplyTarget
            ? "回复已发送"
            : articleId === null
              ? "留言已发送"
              : "评论已发送"
          : `${articleId === null ? "留言" : "评论"}已提交，审核通过后会公开显示`
      );
      await refreshGuestbook(articleId, input.articlePassword);
    } catch (caught) {
      setError(asErrorMessage(caught));
      await refreshGuestbookCaptcha();
    } finally {
      guestbookSubmittingRef.current = false;
      setGuestbookSubmitting(false);
    }
  }

  /** Deletes a guestbook message after administrator confirmation. */
  async function removeGuestbookMessage(id: number, articleId: number | null = null) {
    if (guestbookActionRef.current) {
      return;
    }

    if (!window.confirm(`确定删除这条${articleId === null ? "留言" : "评论"}吗？`)) {
      return;
    }

    const actionKey = `delete-${id}`;
    guestbookActionRef.current = actionKey;
    setGuestbookAction(actionKey);
    setError("");
    try {
      await deleteMessage(id);
      setMessage(`${articleId === null ? "留言" : "评论"}已删除`);
      await refreshGuestbook(articleId, articleId === null ? "" : currentArticlePassword(articleId));
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      guestbookActionRef.current = "";
      setGuestbookAction("");
    }
  }

  /** Toggles public visibility or marks a message invalid from the administrator view. */
  async function changeGuestbookStatus(id: number, status: "pending" | "approved", invalid: boolean, articleId: number | null = null) {
    if (guestbookActionRef.current) return;
    const actionKey = `status-${id}`;
    guestbookActionRef.current = actionKey;
    setGuestbookAction(actionKey);
    setError("");
    try {
      await updateMessageStatus(id, status, invalid);
      setMessage(invalid ? "评论已标记为失效" : status === "approved" ? "评论已公开" : "评论已隐藏");
      await refreshGuestbook(articleId, articleId === null ? "" : currentArticlePassword(articleId));
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      guestbookActionRef.current = "";
      setGuestbookAction("");
    }
  }

  function currentArticlePassword(articleId: number) {
    if (activeArticle?.id !== articleId) return "";
    return new URLSearchParams(window.location.search).get(passwordQueryKey) ?? "";
  }

  return (
    <div className={view === "editor" ? "app-shell app-shell-editor" : "app-shell"}>
      <header className="topbar">
        <button className="brand-button" type="button" onClick={() => showList()}>
          <img className="brand-mark" src="/logo.svg" alt="Cloudflare Blog" />
          <span>
            <strong>Yc556 Blog</strong>
            <small>
              仰晨个人博客
              {authenticated && <span className="auth-pill brand-auth-pill">管理员视图</span>}
            </small>
          </span>
        </button>
        <nav className="top-actions">
          {authenticated && (
            <button
              className="text-button statistics-nav-button"
              type="button"
              onClick={() => showStatistics()}
              disabled={Boolean(routeAction || editingArticleSlug || articleSubmitting || articleDeleting)}
            >
              <BarChart3 size={16} aria-hidden="true" />
              统计
            </button>
          )}
          <button
            className="text-button guestbook-nav-button"
            type="button"
            onClick={() => void showGuestbook()}
            disabled={Boolean(routeAction)}
            title="留言板"
          >
            {routeAction === "guestbook" ? <ButtonSpinner /> : <MessageSquareText size={16} />}
            <span className="button-label">{routeAction === "guestbook" ? "打开中..." : "留言板"}</span>
          </button>
          {authenticated && view !== "editor" && (
            <button
              className="icon-button"
              type="button"
              onClick={newArticle}
              aria-label="新增文章"
              title="新增文章"
              disabled={Boolean(routeAction)}
            >
              {routeAction === "new-article" ? <ButtonSpinner /> : <Plus size={18} />}
            </button>
          )}
          {authenticated ? (
            <button
              className="text-button logout-nav-button"
              type="button"
              onClick={handleLogout}
              disabled={authAction === "logout"}
              aria-label={authAction === "logout" ? "退出登录中" : "退出登录"}
              title="退出登录"
            >
              {authAction === "logout" ? <ButtonSpinner /> : <LogOut size={16} />}
              <span className="button-label">{authAction === "logout" ? "退出中..." : "退出"}</span>
            </button>
          ) : (
            <button className="text-button" type="button" onClick={() => setLoginOpen(true)}>
              <LogIn size={16} />
              登录
            </button>
          )}
        </nav>
      </header>

      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {message && <Status tone="success" text={message} onClose={() => setMessage("")} />}
        {notice && <Status tone="info" text={notice} onClose={() => setNotice("")} />}
        {error && <Status tone="error" text={error} onClose={() => setError("")} />}
      </div>

      <main
        className={
          view === "list" || view === "trash"
            ? "layout"
            : view === "editor"
              ? "layout layout-detail layout-editor"
              : "layout layout-detail"
        }
      >
        {(view === "list" || view === "trash") && (
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
              {authenticated && (
                <button
                  className={view === "trash" ? "tag-filter trash active" : "tag-filter trash"}
                  type="button"
                  onClick={() => void showTrash()}
                  disabled={Boolean(routeAction || editingArticleSlug || articleSubmitting || articleDeleting)}
                >
                  回收站
                  <span>{trashLoading && view === "trash" ? <ButtonSpinner /> : deletedArticleTotal}</span>
                </button>
              )}
            </section>
          </aside>
        )}

        <section className="content-area" ref={contentAreaRef}>
          {view === "list" && (
            <ArticleList
              articles={articles}
              hasMore={hasMoreArticles}
              loading={loading}
              loadingMore={loadingMore}
              search={appliedSearch}
              selectedTagName={selectedTagName}
              authenticated={authenticated}
              editingSlug={editingArticleSlug}
              openingSlug={routeAction.startsWith("article-") ? routeAction.slice("article-".length) : ""}
              deletingSlug={articleDeletingSlug}
              pinningSlug={articlePinningSlug}
              onOpen={openArticle}
              onEdit={editArticle}
              onDelete={removeArticle}
              onTogglePinned={changeArticlePinned}
            />
          )}

          {view === "trash" && (
            <DeletedArticleList
              articles={deletedArticles}
              hasMore={hasMoreDeletedArticles}
              loading={trashLoading}
              loadingMore={trashLoadingMore}
              action={trashArticleAction}
              openingSlug={routeAction.startsWith("deleted-article-") ? routeAction.slice("deleted-article-".length) : ""}
              onBack={() => showList()}
              onOpen={(slug) => void openDeletedArticle(slug)}
              onLoadMore={() => void loadMoreDeletedArticles()}
              onRestore={(slug) => void restoreDeletedArticle(slug)}
              onDelete={(slug) => void permanentlyDeleteDeletedArticle(slug)}
            />
          )}

          {view === "article" && activeArticle && (
            <ArticleView
              article={activeArticle}
              authenticated={authenticated}
              deleting={articleDeleting}
              deleted={Boolean(activeArticle.deletedAt)}
              editing={editingArticleSlug === activeArticle.slug}
              onBack={() => {
                if (activeArticle.deletedAt && authenticated) {
                  void showTrash();
                  return;
                }

                showList({ restoreScroll: true });
              }}
              onEdit={() => editArticle(activeArticle.slug)}
              onDelete={() => removeArticle(activeArticle.slug)}
              onShare={() => void shareArticle()}
              comments={
                <Guestbook
                  mode="article"
                  authenticated={authenticated}
                  captcha={guestbookCaptcha}
                  cooldown={guestbookCooldown}
                  draft={guestbookDraft}
                  loading={guestbookLoading}
                  messages={guestbookMessages}
                  replyTarget={guestbookReplyTarget}
                  submitting={guestbookSubmitting}
                  captchaRefreshing={guestbookCaptchaRefreshing}
                  action={guestbookAction}
                  onCancelReply={() => {
                    setGuestbookReplyTarget(null);
                    setGuestbookDraft((currentDraft) => ({ ...currentDraft, parentId: null }));
                  }}
                  onStatus={(id, status, invalid) => void changeGuestbookStatus(id, status, invalid, activeArticle.id)}
                  onDelete={(id) => void removeGuestbookMessage(id, activeArticle.id)}
                  onDraftChange={setGuestbookDraft}
                  onRefreshCaptcha={() => void refreshGuestbookCaptcha()}
                  onReply={(replyTarget) => {
                    setGuestbookReplyTarget(replyTarget);
                    setGuestbookDraft((currentDraft) => ({ ...currentDraft, parentId: replyTarget.id }));
                    document.getElementById("article-comments")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  onSubmit={(event) => void submitGuestbookMessage(event, activeArticle.id)}
                />
              }
            />
          )}

          {view === "editor" && authenticated && (
            <Editor
              draft={draft}
              availableTags={tagOptions}
              editing={Boolean(editingSlug)}
              submitting={articleSubmitting}
              onError={setError}
              onNotice={setNotice}
              onDraftChange={setDraft}
              onSubmit={submitDraft}
              onCancel={() => (activeArticle ? setView("article") : showList())}
            />
          )}

          {view === "editor" && !authenticated && <EmptyState title="需要登录" description="登录后才能新增或编辑文章。" />}

          {view === "statistics" && authenticated && <StatisticsPage />}

          {view === "statistics" && !authenticated && <EmptyState title="需要登录" description="登录后才能查看访问统计。" />}

          {view === "guestbook" && (
            <Guestbook
              mode="guestbook"
              authenticated={authenticated}
              captcha={guestbookCaptcha}
              cooldown={guestbookCooldown}
              draft={guestbookDraft}
              loading={guestbookLoading}
              messages={guestbookMessages}
              replyTarget={guestbookReplyTarget}
              submitting={guestbookSubmitting}
              captchaRefreshing={guestbookCaptchaRefreshing}
              action={guestbookAction}
              onCancelReply={() => {
                setGuestbookReplyTarget(null);
                setGuestbookDraft((currentDraft) => ({ ...currentDraft, parentId: null }));
              }}
              onStatus={(id, status, invalid) => void changeGuestbookStatus(id, status, invalid)}
              onDelete={(id) => void removeGuestbookMessage(id)}
              onDraftChange={setGuestbookDraft}
              onRefreshCaptcha={() => void refreshGuestbookCaptcha()}
              onReply={(replyTarget) => {
                setGuestbookReplyTarget(replyTarget);
                setGuestbookDraft((currentDraft) => ({ ...currentDraft, parentId: replyTarget.id }));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onSubmit={submitGuestbookMessage}
            />
          )}
        </section>
      </main>

      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} onLogin={handleLogin} />}
      {passwordPrompt && (
        <ArticlePasswordDialog
          state={passwordPrompt}
          onChange={(value) => setPasswordPrompt((current) => (current ? { ...current, value } : current))}
          onClose={() => {
            setPasswordPrompt(null);
            if (!activeArticle && window.location.pathname.startsWith("/articles/")) {
              showList();
            }
          }}
          onSubmit={submitArticlePassword}
        />
      )}
    </div>
  );
}

function Guestbook(props: {
  mode: "guestbook" | "article";
  authenticated: boolean;
  captcha: GuestbookCaptcha | null;
  cooldown: number;
  draft: GuestbookInput;
  loading: boolean;
  messages: GuestbookMessage[];
  replyTarget: GuestbookMessage | null;
  submitting: boolean;
  captchaRefreshing: boolean;
  action: string;
  onCancelReply: () => void;
  onStatus: (id: number, status: "pending" | "approved", invalid: boolean) => void;
  onDelete: (id: number) => void;
  onDraftChange: (draft: GuestbookInput) => void;
  onRefreshCaptcha: () => void;
  onReply: (message: GuestbookMessage) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const canSubmit = props.authenticated || props.cooldown === 0;
  const articleMode = props.mode === "article";

  /** Updates one field in the controlled guestbook draft. */
  function setDraftField<Key extends keyof GuestbookInput>(key: Key, value: GuestbookInput[Key]) {
    props.onDraftChange({ ...props.draft, [key]: value });
  }

  return (
    <div className={articleMode ? "guestbook-page article-comments" : "guestbook-page"} id={articleMode ? "article-comments" : undefined}>
      <section className="guestbook-compose" aria-label={articleMode ? "文章评论输入" : "留言输入"}>
        {props.replyTarget && (
          <div className="reply-context">
            <div className="reply-context-header">
              <strong>您正在回复[{props.replyTarget.nickname}]的以下评论：</strong>
              <button className="text-button ghost" type="button" onClick={props.onCancelReply}>
                取消回复
              </button>
            </div>
            <p>{props.replyTarget.content}</p>
          </div>
        )}
        <form className="guestbook-form" onSubmit={props.onSubmit}>
          <label className="guestbook-content-field">
            {articleMode ? "评论" : "留言"}
            <textarea
              required
              maxLength={500}
              rows={5}
              value={props.draft.content}
              onChange={(event) => setDraftField("content", event.target.value)}
              placeholder={articleMode ? "写下对这篇文章的想法" : "写下想说的话"}
            />
            <span className="field-hint">{props.draft.content.length}/500</span>
          </label>
          <div className="guestbook-fields">
            <label>
              昵称
              <input
                required
                maxLength={10}
                value={props.draft.nickname}
                onChange={(event) => setDraftField("nickname", event.target.value)}
                placeholder="最多 10 个字"
              />
            </label>
            <label>
              邮箱
              <input
                required={!props.authenticated}
                maxLength={120}
                type="email"
                value={props.draft.email}
                onChange={(event) => setDraftField("email", event.target.value)}
                placeholder={props.authenticated ? "管理员可不填" : "不会公开显示"}
              />
            </label>
            {!props.authenticated && (
              <div className="captcha-field">
                <span className="field-label">验证码</span>
                <div className="captcha-row">
                  <button
                    className="captcha-question"
                    type="button"
                    onClick={props.onRefreshCaptcha}
                    disabled={props.captchaRefreshing}
                    title="刷新验证码"
                  >
                    {props.captchaRefreshing ? (
                      <>
                        <ButtonSpinner />
                        刷新中...
                      </>
                    ) : (
                      props.captcha?.question ?? "加载中..."
                    )}
                  </button>
                  <input
                    required
                    inputMode="numeric"
                    value={props.draft.captchaAnswer ?? ""}
                    onChange={(event) => setDraftField("captchaAnswer", event.target.value)}
                    placeholder="答案"
                    aria-label="验证码答案"
                  />
                </div>
              </div>
            )}
          </div>
          <div className="guestbook-submit-row">
            <span>{props.authenticated ? "管理员发送不需要邮箱和验证码。" : props.cooldown > 0 ? `请 ${props.cooldown} 秒后再发送。` : "游客需要填写全部内容。"}</span>
            <button className="text-button primary" type="submit" disabled={props.submitting || !canSubmit}>
              {props.submitting && <ButtonSpinner />}
              {props.submitting ? "发送中..." : props.replyTarget ? "发送回复" : articleMode ? "发送评论" : "发送留言"}
            </button>
          </div>
        </form>
      </section>

      <section className="guestbook-list" aria-label={articleMode ? "文章评论列表" : "留言列表"}>
        <div className="guestbook-list-heading">
          <h1>{articleMode ? "文章评论" : "留言列表"}</h1>
          <span>{props.messages.length} 条{articleMode ? "评论" : "主留言"}</span>
        </div>
        {props.loading && <GuestbookListSkeleton />}
        {!props.loading && props.messages.length === 0 && (
          <EmptyState
            title={articleMode ? "还没有评论" : "还没有留言"}
            description={articleMode ? "来写下第一条评论吧。" : "写下第一条留言吧。"}
          />
        )}
        {!props.loading &&
          props.messages.map((message) => (
            <GuestbookMessageItem
              action={props.action}
              authenticated={props.authenticated}
              key={message.id}
              message={message}
              onStatus={props.onStatus}
              onDelete={props.onDelete}
              onReply={props.onReply}
            />
          ))}
      </section>
    </div>
  );
}

function GuestbookMessageItem(props: {
  action: string;
  authenticated: boolean;
  message: GuestbookMessage;
  onStatus: (id: number, status: "pending" | "approved", invalid: boolean) => void;
  onDelete: (id: number) => void;
  onReply: (message: GuestbookMessage) => void;
}) {
  const deleteActionKey = `delete-${props.message.id}`;
  const statusChanging = props.action === `status-${props.message.id}`;
  const deleting = props.action === deleteActionKey;
  const actionBusy = Boolean(props.action);

  return (
    <article className={props.message.invalid ? "message-card message-invalid" : "message-card"}>
      <div className="message-head">
        <div>
          <strong>{props.message.nickname}</strong>
          {props.message.invalid && <span className="invalid-pill">失效</span>}
          {props.message.localPending && <span className="local-pending-pill">管理员未公开</span>}
          {props.authenticated && props.message.email && <span className="message-email"> {props.message.email}</span>}
          <time dateTime={props.message.createdAt} title={formatDateTime(props.message.createdAt)}>
            {formatDateTime(props.message.createdAt)}
          </time>
        </div>
        <div className="message-actions">
          <button className="text-button ghost" type="button" onClick={() => props.onReply(props.message)}>
            回复
          </button>
          {props.authenticated && (
            <button
              className="icon-button subtle"
              type="button"
              onClick={() => props.onStatus(props.message.id, props.message.status === "approved" ? "pending" : "approved", Boolean(props.message.invalid))}
              disabled={actionBusy}
              aria-label={props.message.status === "approved" ? "隐藏留言" : "公开留言"}
              title={props.message.status === "approved" ? "隐藏留言" : "公开留言"}
            >
              {statusChanging ? <ButtonSpinner /> : props.message.status === "approved" ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          )}
          {props.authenticated && <button className="text-button ghost invalid-action" type="button" onClick={() => props.onStatus(props.message.id, props.message.status ?? "pending", !props.message.invalid)} disabled={actionBusy}>{props.message.invalid ? "恢复正常" : "失效"}</button>}
          {props.authenticated && (
            <button
              className="icon-button subtle danger-icon"
              type="button"
              onClick={() => props.onDelete(props.message.id)}
              aria-label="删除留言"
              disabled={actionBusy}
            >
              {deleting ? <ButtonSpinner /> : <Trash2 size={16} />}
            </button>
          )}
        </div>
      </div>
      <CommentContent content={props.message.content} />
      {props.message.replies.length > 0 && (
        <div className="message-replies">
          {props.message.replies.map((reply) => (
            <GuestbookReplyItem
              action={props.action}
              authenticated={props.authenticated}
              key={reply.id}
              reply={reply}
              onStatus={props.onStatus}
              onDelete={props.onDelete}
              onReply={props.onReply}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function GuestbookReplyItem(props: {
  action: string;
  authenticated: boolean;
  reply: GuestbookMessage;
  onStatus: (id: number, status: "pending" | "approved", invalid: boolean) => void;
  onDelete: (id: number) => void;
  onReply: (message: GuestbookMessage) => void;
}) {
  const deleteActionKey = `delete-${props.reply.id}`;
  const statusChanging = props.action === `status-${props.reply.id}`;
  const deleting = props.action === deleteActionKey;
  const actionBusy = Boolean(props.action);

  return (
    <article className={props.reply.invalid ? "message-reply message-invalid" : "message-reply"}>
      <div className="message-head">
        <div>
          <strong>{props.reply.nickname}</strong>
          {props.reply.invalid && <span className="invalid-pill">失效</span>}
          {props.reply.localPending && <span className="local-pending-pill">管理员未公开</span>}
          {props.authenticated && props.reply.email && <span className="message-email"> {props.reply.email}</span>}
          {props.reply.replyToNickname && <span className="reply-to">回复{props.reply.replyToNickname}：</span>}
          <time dateTime={props.reply.createdAt} title={formatDateTime(props.reply.createdAt)}>
            {formatDateTime(props.reply.createdAt)}
          </time>
        </div>
        <div className="message-actions">
          <button className="text-button ghost" type="button" onClick={() => props.onReply(props.reply)}>
            回复
          </button>
          {props.authenticated && (
            <button
              className="icon-button subtle"
              type="button"
              onClick={() => props.onStatus(props.reply.id, props.reply.status === "approved" ? "pending" : "approved", Boolean(props.reply.invalid))}
              disabled={actionBusy}
              aria-label={props.reply.status === "approved" ? "隐藏回复" : "公开回复"}
              title={props.reply.status === "approved" ? "隐藏回复" : "公开回复"}
            >
              {statusChanging ? <ButtonSpinner /> : props.reply.status === "approved" ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          )}
          {props.authenticated && <button className="text-button ghost invalid-action" type="button" onClick={() => props.onStatus(props.reply.id, props.reply.status ?? "pending", !props.reply.invalid)} disabled={actionBusy}>{props.reply.invalid ? "恢复正常" : "失效"}</button>}
          {props.authenticated && (
            <button
              className="icon-button subtle danger-icon"
              type="button"
              onClick={() => props.onDelete(props.reply.id)}
              aria-label="删除回复"
              disabled={actionBusy}
            >
              {deleting ? <ButtonSpinner /> : <Trash2 size={16} />}
            </button>
          )}
        </div>
      </div>
      <CommentContent content={props.reply.content} />
    </article>
  );
}

/** Renders lightweight comment Markdown while rejecting HTML, headings, tables, and unsafe images. */
export function CommentContent(props: { content: string }) {
  /** Restricts images to HTTPS while applying the Markdown library's safe link protocol filter. */
  function transformCommentUrl(url: string, key: string) {
    if (key === "href") {
      return defaultUrlTransform(url);
    }

    if (key !== "src") {
      return "";
    }

    try {
      return new URL(url).protocol === "https:" ? url : "";
    } catch {
      return "";
    }
  }

  return (
    <div className="message-content">
      <ReactMarkdown
        allowedElements={commentMarkdownElements}
        remarkPlugins={[remarkGfm, remarkSoftLineBreaks]}
        skipHtml
        unwrapDisallowed
        urlTransform={transformCommentUrl}
        components={{
          a: ({ node: _node, ...linkProps }) => <a {...linkProps} target="_blank" rel="noopener noreferrer" />,
          img: ({ node: _node, ...imageProps }) => (
            <img {...imageProps} className="comment-image" loading="lazy" referrerPolicy="no-referrer" />
          )
        }}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  );
}

function GuestbookListSkeleton() {
  return (
    <div className="guestbook-list-skeleton" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div className="message-card skeleton-message" key={index}>
          <div className="skeleton-message-head">
            <span className="skeleton-line name" />
            <span className="skeleton-line date" />
          </div>
          <span className="skeleton-line text" />
          <span className="skeleton-line text medium" />
          {index === 0 && (
            <div className="message-replies">
              <div className="message-reply skeleton-message-reply">
                <span className="skeleton-line name" />
                <span className="skeleton-line text short" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Reads the remaining local guest cooldown in seconds. */
function readGuestbookCooldown() {
  const lastSentAt = Number(window.localStorage.getItem(guestbookCooldownKey) ?? 0); // Last local guest send timestamp.
  if (!lastSentAt) {
    return 0;
  }

  const elapsedSeconds = Math.floor((Date.now() - lastSentAt) / 1000); // Seconds since the latest local send.
  return Math.max(0, guestbookCooldownSeconds - elapsedSeconds);
}

function ArticleList(props: {
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
              {article.excerpt && <p>{article.excerpt}</p>}
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

interface PendingGuestbookRecord {
  scope: string;
  message: GuestbookMessage;
}

/** Reads visitor-owned pending messages from local storage. */
function readPendingGuestbookMessages(scope: string): PendingGuestbookRecord[] {
  try {
    const records = JSON.parse(window.localStorage.getItem(guestbookPendingKey) ?? "[]") as PendingGuestbookRecord[];
    return records.filter((record) => record?.scope === scope && Number.isInteger(record.message?.id));
  } catch {
    return [];
  }
}

/** Writes the retained pending-message records while preserving other scopes. */
function writePendingGuestbookMessages(scope: string, scopeRecords: PendingGuestbookRecord[]) {
  try {
    const all = JSON.parse(window.localStorage.getItem(guestbookPendingKey) ?? "[]") as PendingGuestbookRecord[];
    const other = all.filter((record) => record.scope !== scope);
    window.localStorage.setItem(guestbookPendingKey, JSON.stringify([...other, ...scopeRecords]));
  } catch {
    // Local storage can be unavailable in privacy-restricted browsers.
  }
}

/** Adds a freshly submitted visitor message to its local moderation queue. */
function addPendingGuestbookMessage(scope: string, message: GuestbookMessage) {
  const records = readPendingGuestbookMessages(scope).filter((record) => record.message.id !== message.id);
  writePendingGuestbookMessages(scope, [...records, { scope, message }]);
}

/** Flattens the two-level message tree for local ID reconciliation. */
function flattenGuestbookMessages(messages: GuestbookMessage[]) {
  return messages.flatMap((message) => [message, ...message.replies]);
}

/** Marks rows retained locally so the visitor can see their moderation state. */
function markLocalPendingMessages(messages: GuestbookMessage[], ids: Set<number>): GuestbookMessage[] {
  return messages.map((message) => ({
    ...message,
    localPending: ids.has(message.id) && message.status === "pending",
    replies: message.replies.map((reply) => ({
      ...reply,
      localPending: ids.has(reply.id) && reply.status === "pending"
    }))
  }));
}

function DeletedArticleList(props: {
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
                {article.excerpt && <p>{article.excerpt}</p>}
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

/** Highlights the matching search phrase inside a body snippet without injecting HTML. */
function HighlightedSnippet(props: { query: string; text: string }) {
  const query = props.query.trim(); // Search phrase highlighted in the snippet.
  if (!query) {
    return <>{props.text}</>;
  }

  const lowerText = props.text.toLowerCase(); // Lowercase snippet for finding all matches.
  const lowerQuery = query.toLowerCase(); // Lowercase query for case-insensitive matching.
  const parts: React.ReactNode[] = [];
  let cursor = 0; // Current text offset while splitting the snippet.
  let matchIndex = lowerText.indexOf(lowerQuery);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(props.text.slice(cursor, matchIndex));
    }

    const endIndex = matchIndex + query.length; // End offset of the highlighted phrase.
    parts.push(<mark key={`${matchIndex}-${endIndex}`}>{props.text.slice(matchIndex, endIndex)}</mark>);
    cursor = endIndex;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < props.text.length) {
    parts.push(props.text.slice(cursor));
  }

  return <>{parts}</>;
}

function ArticleView(props: {
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
    </article>
  );
}

export function MarkdownRenderer(props: { content: string }) {
  const [lightboxImage, setLightboxImage] = useState<MarkdownImageData | null>(null); // Currently enlarged Markdown image.
  const [lightboxScale, setLightboxScale] = useState(1); // Current lightbox image scale.
  const [lightboxOffset, setLightboxOffset] = useState({ x: 0, y: 0 }); // Current image drag offset.
  const lightboxDragRef = useRef<LightboxDragState | null>(null); // Active pointer drag state.
  const suppressLightboxClickRef = useRef(false); // Prevents a drag release from closing the image.

  /** Opens a Markdown image and resets its zoom level. */
  const openLightboxImage = useCallback((image: MarkdownImageData) => {
    setLightboxImage(image);
    setLightboxScale(1);
    setLightboxOffset({ x: 0, y: 0 });
    suppressLightboxClickRef.current = false;
  }, []);

  /** Closes the lightbox and restores its default zoom level. */
  const closeLightbox = useCallback(() => {
    setLightboxImage(null);
    setLightboxScale(1);
    setLightboxOffset({ x: 0, y: 0 });
    lightboxDragRef.current = null;
    suppressLightboxClickRef.current = false;
  }, []);

  /** Applies mouse-wheel zoom while keeping the image scale within safe bounds. */
  const handleLightboxWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextScale = Math.min(maxLightboxScale, Math.max(minLightboxScale, lightboxScale - event.deltaY * lightboxScaleStep)); // Scale after this wheel event.
    setLightboxScale(nextScale);
    if (nextScale <= 1) {
      setLightboxOffset({ x: 0, y: 0 });
    }
  }, [lightboxScale]);

  /** Starts dragging the enlarged image when it is zoomed beyond its base size. */
  const handleLightboxPointerDown = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    if (lightboxScale <= 1 || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    lightboxDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: lightboxOffset.x,
      originY: lightboxOffset.y,
      moved: false
    };
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }, [lightboxOffset.x, lightboxOffset.y, lightboxScale]);

  /** Moves the enlarged image while the pointer is held down. */
  const handleLightboxPointerMove = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const drag = lightboxDragRef.current; // Current pointer drag state.
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX; // Horizontal pointer movement.
    const deltaY = event.clientY - drag.startY; // Vertical pointer movement.
    if (!drag.moved && Math.hypot(deltaX, deltaY) < lightboxDragThreshold) {
      return;
    }

    drag.moved = true;
    setLightboxOffset({ x: drag.originX + deltaX, y: drag.originY + deltaY });
  }, []);

  /** Ends an image drag and suppresses the synthetic click generated after movement. */
  const handleLightboxPointerUp = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const drag = lightboxDragRef.current; // Current pointer drag state.
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    lightboxDragRef.current = null;
    if (typeof event.currentTarget.hasPointerCapture === "function" && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    suppressLightboxClickRef.current = drag.moved;
  }, []);

  /** Closes on a simple image click while preserving a completed drag. */
  const handleLightboxImageClick = useCallback((event: React.MouseEvent<HTMLImageElement>) => {
    event.stopPropagation();
    if (suppressLightboxClickRef.current) {
      suppressLightboxClickRef.current = false;
      return;
    }

    closeLightbox();
  }, [closeLightbox]);

  useEffect(() => {
    if (!lightboxImage) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow; // Body overflow value restored after closing the preview.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeLightbox();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeLightbox, lightboxImage]);

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkSoftLineBreaks, remarkHighlightMark, remarkHighlightMarkElement]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], [rehypeHighlight, { detect: true }]]}
        components={{
          a: ({ children, node: _node, ...anchorProps }) => (
            <a {...anchorProps} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ node: _node, ...imageProps }) => <MarkdownImage {...imageProps} onOpen={openLightboxImage} />,
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
        }}
      >
        {props.content}
      </ReactMarkdown>
      {lightboxImage && (
        <div
          className="markdown-image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={closeLightbox}
          onWheel={handleLightboxWheel}
        >
          <button
            className="markdown-image-lightbox-close"
            type="button"
            aria-label="关闭图片预览"
            onClick={closeLightbox}
          >
            <X size={22} />
          </button>
          <div className="markdown-image-lightbox-stage" onClick={closeLightbox}>
            <img
              className="markdown-image-lightbox-image"
              src={lightboxImage.src}
              alt={lightboxImage.alt}
              draggable={false}
              style={{ transform: `translate(${lightboxOffset.x}px, ${lightboxOffset.y}px) scale(${lightboxScale})` }}
              onClick={handleLightboxImageClick}
              onDragStart={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                event.preventDefault();
                handleLightboxPointerDown(event);
              }}
              onPointerMove={(event) => {
                event.preventDefault();
                handleLightboxPointerMove(event);
              }}
              onPointerUp={handleLightboxPointerUp}
              onPointerCancel={handleLightboxPointerUp}
            />
          </div>
          <span className="markdown-image-lightbox-hint" aria-live="polite">
            滚动缩放 · {Math.round(lightboxScale * 100)}%
          </span>
        </div>
      )}
    </>
  );
}

interface MarkdownImageData {
  src: string;
  alt: string;
}

interface LightboxDragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

interface MarkdownImageProps {
  alt?: string;
  src?: string;
  title?: string;
  onOpen: (image: MarkdownImageData) => void;
}

/** Renders a Markdown image that can be opened in an accessible full-screen preview. */
function MarkdownImage(props: MarkdownImageProps) {
  const alt = props.alt ?? ""; // Alternative text shown when the image cannot load.
  const src = props.src ?? ""; // Source URL for the Markdown image.

  if (!src) {
    return <img alt={alt} title={props.title} />;
  }

  /** Opens this image in the parent Markdown lightbox. */
  function openImage() {
    props.onOpen({ src, alt });
  }

  return (
    <span
      className="markdown-image-trigger"
      role="button"
      tabIndex={0}
      aria-label={`放大查看图片：${alt || "图片"}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openImage();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          openImage();
        }
      }}
    >
      <img src={src} alt={alt} title={props.title} />
    </span>
  );
}

interface MarkdownAstNode {
  type?: string;
  data?: Record<string, unknown>;
  value?: string;
  children?: MarkdownAstNode[];
}

/** Converts Markdown soft line breaks into explicit break nodes while leaving code blocks untouched. */
function remarkSoftLineBreaks() {
  return (tree: MarkdownAstNode) => {
    /** Rewrites newline-containing text children and recursively visits nested Markdown content. */
    const visit = (node: MarkdownAstNode) => {
      if (!node.children) {
        return;
      }

      const nextChildren: MarkdownAstNode[] = []; // Children with soft line breaks replaced by break nodes.
      node.children.forEach((child) => {
        if (child.type === "text" && child.value?.includes("\n")) {
          const lines = child.value.split("\n"); // Text fragments separated by source line breaks.
          lines.forEach((line, index) => {
            if (line) {
              nextChildren.push({ ...child, value: line });
            }
            if (index < lines.length - 1) {
              nextChildren.push({ type: "break" });
            }
          });
        } else {
          nextChildren.push(child);
        }
      });

      node.children = nextChildren;
      node.children.forEach(visit);
    };

    visit(tree);
  };
}

/** Maps the plugin's highlight node to a safe mark element for rehype. */
function remarkHighlightMarkElement() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
      if (node.type === "highlight") {
        node.data = { ...node.data, hName: "mark" };
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}

function CodeBlock(props: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeElement = Array.isArray(props.children) ? props.children[0] : props.children;
  const codeProps =
    typeof codeElement === "object" && codeElement !== null && "props" in codeElement
      ? (codeElement.props as { className?: string; children?: React.ReactNode })
      : {};
  const className = codeProps.className ?? "";
  const language = className.match(/language-([\w-]+)/)?.[1] ?? "text";
  const codeText = extractText(codeProps.children);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language}</span>
        <button type="button" onClick={copyCode}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{props.children}</pre>
    </div>
  );
}

function ButtonSpinner() {
  return <span className="button-spinner" aria-hidden="true" />;
}

function extractText(value: React.ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(extractText).join("");
  }

  if (typeof value === "object" && value !== null && "props" in value) {
    return extractText((value.props as { children?: React.ReactNode }).children);
  }

  return "";
}

function Editor(props: {
  draft: ArticleInput;
  availableTags: TagType[];
  editing: boolean;
  submitting: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onDraftChange: (draft: ArticleInput) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [uploadingTarget, setUploadingTarget] = useState<"cover" | "content" | "">("");
  const draftRef = useRef(props.draft);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    draftRef.current = props.draft;
  }, [props.draft]);

  /** Updates the draft and its synchronous ref used by asynchronous uploads. */
  function updateDraft(nextDraft: ArticleInput) {
    draftRef.current = nextDraft;
    props.onDraftChange(nextDraft);
  }

  const setField = <Key extends keyof ArticleInput>(key: Key, value: ArticleInput[Key]) => {
    updateDraft({ ...draftRef.current, [key]: value });
  };

  /** Uploads a pasted image and writes its URL into the list-image field. */
  async function uploadCoverImage(file: File) {
    if (uploadingTarget) {
      props.onError("请等待当前图片上传完成");
      return;
    }

    setUploadingTarget("cover");
    try {
      const prepared = await prepareImageForUpload(file);
      const result = await uploadImageWithFallback(prepared.file);
      setField("coverImageUrl", result.url);
      props.onNotice(`${prepared.convertedToWebp ? "已转为 WebP，" : ""}图片已上传到 ${imageHostLabels[result.provider]}`);
    } catch (error) {
      props.onError(asErrorMessage(error));
    } finally {
      setUploadingTarget("");
    }
  }

  /** Inserts a temporary Markdown marker and replaces it with the uploaded image URL. */
  async function uploadContentImage(file: File, selectionStart: number, selectionEnd: number) {
    if (uploadingTarget) {
      props.onError("请等待当前图片上传完成");
      return;
    }

    const markerId = `uploading-${crypto.randomUUID()}`; // Unique marker preserved across asynchronous state updates.
    const marker = markdownImage(markerId, "图片上传中…");
    const content = draftRef.current.content;
    updateDraft({ ...draftRef.current, content: `${content.slice(0, selectionStart)}${marker}${content.slice(selectionEnd)}` });
    setUploadingTarget("content");

    try {
      const prepared = await prepareImageForUpload(file);
      const result = await uploadImageWithFallback(prepared.file);
      updateDraft({ ...draftRef.current, content: draftRef.current.content.replace(marker, markdownImage(result.url)) });
      props.onNotice(`${prepared.convertedToWebp ? "已转为 WebP，" : ""}图片已上传到 ${imageHostLabels[result.provider]}`);
    } catch (error) {
      updateDraft({ ...draftRef.current, content: draftRef.current.content.replace(marker, "") });
      props.onError(asErrorMessage(error));
    } finally {
      setUploadingTarget("");
      window.requestAnimationFrame(() => contentTextareaRef.current?.focus());
    }
  }

  /** Captures an image from the cover input clipboard without affecting normal text paste. */
  function handleCoverPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const image = clipboardImage(event.clipboardData);
    if (!image) {
      return;
    }
    event.preventDefault();
    void uploadCoverImage(image);
  }

  /** Captures an image from the Markdown textarea and remembers its insertion point. */
  function handleContentPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const image = clipboardImage(event.clipboardData);
    if (!image) {
      return;
    }
    event.preventDefault();
    void uploadContentImage(image, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
  }

  /** Converts standalone image URL lines in the article body to Markdown images. */
  function convertImageLinks() {
    const result = convertStandaloneImageLinks(draftRef.current.content);
    if (result.convertedCount === 0) {
      props.onNotice("未识别到可转换的图片链接");
      return;
    }

    setField("content", result.content);
    props.onNotice(`已将 ${result.convertedCount} 个图片链接转为 Markdown`);
    window.requestAnimationFrame(() => contentTextareaRef.current?.focus());
  }

  return (
    <form className="editor" onSubmit={props.onSubmit}>
      <div className="content-heading compact">
        <div>
          <p>{props.editing ? "Edit Post" : "New Post"}</p>
          <h1>{props.editing ? "编辑文章" : "新增文章"}</h1>
        </div>
        <div className="tool-group">
          <button className="text-button ghost" type="button" onClick={props.onCancel} disabled={props.submitting || Boolean(uploadingTarget)}>
            取消
          </button>
          <button className="text-button primary" type="submit" disabled={props.submitting || Boolean(uploadingTarget)}>
            {(props.submitting || uploadingTarget) && <ButtonSpinner />}
            {props.submitting ? "保存中..." : uploadingTarget ? "图片上传中..." : "保存"}
          </button>
        </div>
      </div>

      <div className="editor-grid">
        <div className="editor-fields">
          <div className="editor-meta">
            <label>
              标题
              <input
                required
                maxLength={120}
                value={props.draft.title}
                onChange={(event) => setField("title", event.target.value)}
                placeholder="文章标题"
              />
            </label>
            <label>
              摘要
              <textarea
                maxLength={240}
                rows={3}
                value={props.draft.excerpt}
                onChange={(event) => setField("excerpt", event.target.value)}
                placeholder="一两句话概括这篇文章"
              />
            </label>
            <label>
              列表图片
              <input
                maxLength={2048}
                value={props.draft.coverImageUrl}
                onChange={(event) => setField("coverImageUrl", event.target.value)}
                onPaste={handleCoverPaste}
                placeholder="图片 URL，可留空"
                disabled={Boolean(uploadingTarget)}
              />
              <span className="image-upload-hint">可直接粘贴图片，自动转 WebP 并上传</span>
            </label>
            <TagSelector
              selectedTags={props.draft.tags}
              availableTags={props.availableTags}
              onChange={(tags) => setField("tags", tags)}
            />
            <fieldset className="visibility-control">
              <legend>可见性</legend>
              <SegmentedVisibility
                value={props.draft.visibility}
                onChange={(value) => {
                  const nextDraft = { ...draftRef.current, visibility: value };
                  if (value === "password" && !nextDraft.accessPassword) {
                    nextDraft.accessPassword = createDefaultArticlePassword();
                  }
                  if (value !== "password") {
                    nextDraft.accessPassword = "";
                  }
                  updateDraft(nextDraft);
                }}
              />
            </fieldset>
            {props.draft.visibility === "password" && (
              <label>
                访问密码
                <input
                  required
                  maxLength={4}
                  minLength={4}
                  pattern="[A-Za-z0-9]{4}"
                  value={props.draft.accessPassword}
                  onChange={(event) => setField("accessPassword", event.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 4))}
                  placeholder="4 位字母或数字"
                  autoComplete="off"
                />
              </label>
            )}
          </div>
          <div className="editor-compose">
            <div className="content-field">
              <div className="editor-compose-heading">
                <label htmlFor="article-markdown-content">Markdown</label>
                <div className="editor-compose-actions">
                  <button className="text-button ghost editor-convert-button" type="button" onClick={convertImageLinks}>
                    <ImageIcon size={15} />
                    识别图片链接转md
                  </button>
                </div>
              </div>
              <span className="image-upload-hint">在光标处粘贴图片，将自动插入 Markdown 图片链接</span>
              <textarea
                id="article-markdown-content"
                ref={contentTextareaRef}
                required
                value={props.draft.content}
                onChange={(event) => setField("content", event.target.value)}
                onPaste={handleContentPaste}
                spellCheck={false}
                disabled={Boolean(uploadingTarget)}
              />
            </div>
          </div>
        </div>

        <div className="preview-panel">
          <div className="preview-title">预览</div>
          <div className="markdown-body article-markdown preview-body">
            <MarkdownRenderer content={props.draft.content || "开始写 Markdown 后，这里会实时预览。"} />
          </div>
        </div>
      </div>
    </form>
  );
}

function TagSelector(props: {
  selectedTags: string[];
  availableTags: TagType[];
  onChange: (tags: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const normalizedSelected = useMemo(() => new Set(props.selectedTags.map((tag) => tag.toLowerCase())), [props.selectedTags]);
  const filteredTags = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return props.availableTags
      .filter((tag) => !normalizedSelected.has(tag.name.toLowerCase()))
      .filter((tag) => !normalizedQuery || tag.name.toLowerCase().includes(normalizedQuery))
      .slice(0, 8);
  }, [props.availableTags, normalizedSelected, query]);
  const canCreate = query.trim().length > 0 && !normalizedSelected.has(query.trim().toLowerCase());
  const showOptions = focused && (filteredTags.length > 0 || canCreate);

  function addTag(tagName: string) {
    const cleaned = tagName.trim();
    if (!cleaned || normalizedSelected.has(cleaned.toLowerCase())) {
      setQuery("");
      return;
    }

    props.onChange([...props.selectedTags, cleaned]);
    setQuery("");
    setFocused(true);
  }

  function removeTag(tagName: string) {
    props.onChange(props.selectedTags.filter((tag) => tag.toLowerCase() !== tagName.toLowerCase()));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag(query || filteredTags[0]?.name || "");
    }

    if (event.key === "Backspace" && !query && props.selectedTags.length > 0) {
      event.preventDefault();
      removeTag(props.selectedTags[props.selectedTags.length - 1]);
    }
  }

  return (
    <div className="tag-selector-field">
      <span className="field-label">标签</span>
      <div
        className="tag-selector"
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocused(false);
          }
        }}
      >
        <div className="tag-selector-input">
          {props.selectedTags.map((tag) => (
            <button className="tag-chip" type="button" key={tag} onClick={() => removeTag(tag)} title={`移除 ${tag}`}>
              {tag}
              <X size={13} />
            </button>
          ))}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            placeholder={props.selectedTags.length ? "搜索或新增标签" : "搜索标签，回车新增"}
            aria-label="搜索或新增标签"
          />
          <Search size={16} className="tag-selector-search" aria-hidden="true" />
        </div>
        {showOptions && (
          <div className="tag-options" role="listbox" aria-label="标签候选">
            {filteredTags.map((tag) => (
              <button
                className="tag-option"
                type="button"
                key={tag.slug}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(tag.name)}
              >
                <TagIcon size={14} />
                {tag.name}
              </button>
            ))}
            {canCreate && (
              <button
                className="tag-option create"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(query)}
              >
                <Plus size={14} />
                新增“{query.trim()}”
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SegmentedVisibility(props: { value: Visibility; onChange: (value: Visibility) => void }) {
  return (
    <div className="segmented">
      <button
        className={props.value === "public" ? "active" : ""}
        type="button"
        onClick={() => props.onChange("public")}
      >
        <Eye size={16} />
        公开
      </button>
      <button
        className={props.value === "private" ? "active" : ""}
        type="button"
        onClick={() => props.onChange("private")}
      >
        <EyeOff size={16} />
        登录可见
      </button>
      <button
        className={props.value === "password" ? "active" : ""}
        type="button"
        onClick={() => props.onChange("password")}
      >
        <Lock size={16} />
        密码可见
      </button>
    </div>
  );
}

/** Returns the first pasted clipboard image, if the paste contains one. */
function clipboardImage(clipboardData: DataTransfer) {
  return Array.from(clipboardData.files).find((file) => file.type.startsWith("image/")) ?? null;
}

/** Creates a four-character alphanumeric password for a newly protected article. */
function createDefaultArticlePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function ArticlePasswordDialog(props: {
  state: PasswordPromptState;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="login-dialog password-dialog" onSubmit={props.onSubmit}>
        <div className="dialog-header">
          <h2>输入访问密码</h2>
          <button className="icon-button subtle" type="button" onClick={props.onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <p className="dialog-description">这篇文章需要密码才能查看。</p>
        {props.state.error && <Status tone="error" text={props.state.error} onClose={() => undefined} />}
        <label>
          访问密码
          <input
            autoFocus
            required
            maxLength={4}
            minLength={4}
            pattern="[A-Za-z0-9]{4}"
            value={props.state.value}
            onChange={(event) => props.onChange(event.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 4))}
            autoComplete="off"
          />
        </label>
        <button className="text-button primary full" type="submit">
          <Lock size={16} />
          解锁文章
        </button>
      </form>
    </div>
  );
}

function LoginDialog(props: { onClose: () => void; onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await props.onLogin(username, password);
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="login-dialog" onSubmit={submit}>
        <div className="dialog-header">
          <h2>管理员登录</h2>
          <button className="icon-button subtle" type="button" onClick={props.onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        {error && <Status tone="error" text={error} onClose={() => setError("")} />}
        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button className="text-button primary full" type="submit" disabled={submitting}>
          {submitting && <ButtonSpinner />}
          {submitting ? "登录中..." : "登录"}
        </button>
      </form>
    </div>
  );
}

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

function Status(props: { tone: "success" | "info" | "error"; text: string; onClose: () => void }) {
  return (
    <div className={`status ${props.tone}`}>
      <span>{props.text}</span>
      <button type="button" onClick={props.onClose} aria-label="关闭提示">
        <X size={16} />
      </button>
    </div>
  );
}

function EmptyState(props: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <h2>{props.title}</h2>
      <p>{props.description}</p>
    </div>
  );
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
