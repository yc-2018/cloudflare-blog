import { SiteHeader } from "./components/SiteHeader";
import { ArticleSidebar } from "./components/ArticleSidebar";
import { useArticleList } from "./hooks/useArticleList";
import { useArticleTrash } from "./hooks/useArticleTrash";
import { useHomeHero } from "./hooks/useHomeHero";
import { useGuestbook } from "./hooks/useGuestbook";
import { useEffect, useRef, useState } from "react";
import React from "react";
import {
  createArticle,
  deleteArticle,
  getArticle,
  getMe,
  login,
  logout,
  toggleArticlePinned,
  updateArticle,
  ApiRequestError
} from "./api";
import type { Article, ArticleInput } from "./types";
import { articleToInput, emptyArticleInput, sampleMarkdown } from "./utils";
import { StatisticsPage } from "./StatisticsPage";
import { Status, EmptyState } from "./components/Feedback";
import { ArticleList, DeletedArticleList } from "./components/ArticleList";
import { ArticleView } from "./components/ArticleView";
import { HeroLanding } from "./components/HeroLanding";
import { Guestbook } from "./components/Guestbook";
import { Editor } from "./components/Editor";
import { type PasswordPromptState, ArticlePasswordDialog, LoginDialog } from "./components/Dialogs";
import {
  guestbookPath,
  statisticsPath,
  trashPath,
  passwordQueryKey,
  articlesHash,
  articlePath,
  slugFromPath
} from "./navigation";
import { asErrorMessage } from "./utils";

type View = "list" | "article" | "editor" | "guestbook" | "statistics" | "trash";

const siteTitle = "仰晨博客"; // 文章页以外使用的浏览器标题。

/** 协调页面路由、登录状态和文章操作，并组合独立的功能组件。 */
export function App() {
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<ArticleInput>({ ...emptyArticleInput, content: sampleMarkdown() });
  const [view, setView] = useState<View>("list");
  const [authenticated, setAuthenticated] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPromptState | null>(null);
  const [articleSubmitting, setArticleSubmitting] = useState(false);
  const [articleDeleting, setArticleDeleting] = useState(false);
  const [articleDeletingSlug, setArticleDeletingSlug] = useState("");
  const [articlePinningSlug, setArticlePinningSlug] = useState("");
  const [editingArticleSlug, setEditingArticleSlug] = useState("");
  const [routeAction, setRouteAction] = useState("");
  const [authAction, setAuthAction] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const contentAreaRef = useRef<HTMLElement | null>(null);
  const listScrollY = useRef(0);
  const articleSubmittingRef = useRef(false);
  const articleDeletingRef = useRef(false);
  const routeActionRef = useRef("");
  const routeActionOwnerRef = useRef(0);
  const authActionRef = useRef("");
  const articleOpenRequestId = useRef(0);

  const {
    articles, setArticles, tags, tagOptions, selectedTag, setSelectedTag,
    search, setSearch, appliedSearch, selectedTagName,
    loading, setLoading, loadingMore, allArticleTotal, untaggedArticleTotal,
    hasMoreArticles, refreshContent, refreshTagOptions
  } = useArticleList({ active: view === "list", contentAreaRef, onError: setError });
  const {
    deletedArticles, deletedArticleTotal, trashLoading, trashLoadingMore,
    trashArticleAction, hasMoreDeletedArticles, refreshDeletedArticles,
    loadMoreDeletedArticles, restoreDeletedArticle, permanentlyDeleteDeletedArticle,
    clearDeletedArticles
  } = useArticleTrash({ refreshContent, onError: setError, onMessage: setMessage });
  const {
    homeShowingHero, setHomeShowingHero, homeBackground, archiveTransitioning,
    enterArticleList, returnToHomeHero
  } = useHomeHero({ isListView: view === "list", showList });
  const guestbook = useGuestbook({
    authenticated,
    articleId: view === "guestbook" ? null : view === "article" ? activeArticle?.id : undefined,
    onError: setError,
    onMessage: setMessage
  });

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

  useEffect(() => {
    if (!authenticated) {
      clearDeletedArticles();
      if (view === "trash") {
        showList();
      }
      return;
    }
  }, [authenticated, view]);

  /** 读取登录状态并准备初始列表，再同步浏览器当前路由。 */
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

  /** 根据地址恢复页面，并阻止旧文章请求覆盖当前路由。 */
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
      setHomeShowingHero(window.location.hash !== articlesHash);
      setView("list");
      return;
    }

    invalidateArticleOpenRequest();
    const routeParams = new URLSearchParams(window.location.search); // 当前文章路由的查询参数值。
    const includeDeleted = routeParams.get("deleted") === "1"; // 该路由是否指向回收站中的文章。
    if (includeDeleted && !authenticatedOverride) {
      setLoginOpen(true);
      setView("list");
      return;
    }

    await loadArticle(slug, false, routeParams.get(passwordQueryKey) ?? "", includeDeleted);
  }

  /** 保存列表滚动位置，并为打开文章的异步操作持有路由锁。 */
  async function openArticle(slug: string) {
    if (routeActionRef.current) {
      return;
    }

    const actionKey = `article-${slug}`; // 本次文章请求的展示键。
    const actionOwner = beginRouteAction(actionKey); // 本次调用的唯一持有者标识。
    const scrollElement = contentAreaRef.current;
    listScrollY.current = scrollElement && scrollElement.scrollHeight > scrollElement.clientHeight + 1 ? scrollElement.scrollTop : window.scrollY;
    try {
      await loadArticle(slug, true);
    } finally {
      releaseRouteAction(actionOwner, actionKey);
    }
  }

  /** 加载一篇文章，并将单页应用切换到文章视图。 */
  async function loadArticle(slug: string, pushUrl: boolean, password = "", includeDeleted = false) {
    const requestId = articleOpenRequestId.current + 1; // 允许提交下一个文章路由状态的请求标识。
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
      window.requestAnimationFrame(() => {
        document.getElementById("article-detail-anchor")?.scrollIntoView({ behavior: "auto", block: "start" });
      });
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

  /** 打开回收站中的文章，供管理员只读查看。 */
  async function openDeletedArticle(slug: string) {
    if (routeActionRef.current) {
      return;
    }

    const actionKey = `deleted-article-${slug}`; // 本次回收站文章请求的展示键。
    const actionOwner = beginRouteAction(actionKey); // 本次调用的唯一持有者标识。
    try {
      await loadArticle(slug, true, "", true);
    } finally {
      releaseRouteAction(actionOwner, actionKey);
    }
  }

  /** 启动一个具有唯一持有者的异步路由动作，并保留其展示键。 */
  function beginRouteAction(actionKey: string) {
    const owner = routeActionOwnerRef.current + 1; // 单调递增的标识，区别于可复用的展示键。
    routeActionOwnerRef.current = owner;
    routeActionRef.current = actionKey;
    setRouteAction(actionKey);
    return owner;
  }

  /** 仅当完成的操作仍持有该路由动作时才释放它。 */
  function releaseRouteAction(owner: number, actionKey: string) {
    if (routeActionOwnerRef.current !== owner || routeActionRef.current !== actionKey) {
      return;
    }

    routeActionOwnerRef.current += 1;
    routeActionRef.current = "";
    setRouteAction("");
  }

  /** 防止进行中的文章与路由动作覆盖更新的切换。 */
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

  /** 返回文章列表，按需恢复离开前的滚动位置。 */
  function showList(options: { restoreScroll?: boolean } = {}) {
    invalidateArticleOpenRequest();
    setActiveArticle(null);
    setEditingSlug(null);
    setView("list");
    setHomeShowingHero(false);
    setPasswordPrompt(null);
    if (window.location.pathname !== "/" || window.location.hash !== articlesHash) {
      window.history.pushState(null, "", `/${articlesHash}`);
    }
    window.requestAnimationFrame(() => {
      const scrollTop = options.restoreScroll ? listScrollY.current : 0; // 已保存的文章栏滚动位置。
      if (contentAreaRef.current && contentAreaRef.current.scrollHeight > contentAreaRef.current.clientHeight + 1) {
        contentAreaRef.current.scrollTop = scrollTop;
      } else {
        window.scrollTo({ top: scrollTop, behavior: "auto" });
      }
    });
  }

  /** 在应用文章列表标签筛选前，先从回收站或详情视图返回。 */
  function selectArticleTag(tagSlug: string) {
    showList();
    setSelectedTag(tagSlug);
  }

  /** 打开管理员文章回收站并刷新其第一页。 */
  async function showTrash(pushUrl = true) {
    if (routeActionRef.current || !authenticated) {
      return;
    }

    invalidateArticleOpenRequest();
    const actionKey = "trash"; // 回收站刷新的展示键。
    const actionOwner = beginRouteAction(actionKey); // 本次调用的唯一持有者标识。
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

  /** 打开可分享的留言板视图并刷新其当前留言。 */
  async function showGuestbook(pushUrl = true) {
    if (routeActionRef.current) {
      return;
    }

    invalidateArticleOpenRequest();
    const actionKey = "guestbook"; // 本次留言板刷新的展示键。
    const actionOwner = beginRouteAction(actionKey); // 本次调用的唯一持有者标识。
    setActiveArticle(null);
    setEditingSlug(null);
    setPasswordPrompt(null);
    setView("guestbook");
    if (pushUrl && window.location.pathname !== guestbookPath) {
      window.history.pushState(null, "", guestbookPath);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      await guestbook.refresh();
    } finally {
      releaseRouteAction(actionOwner, actionKey);
    }
  }

  /** 打开管理员访问统计，同时保留可直接分享的路由。 */
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

  /** 准备新文章草稿与标签选项，并进入编辑器。 */
  function newArticle() {
    if (routeActionRef.current) {
      return;
    }

    invalidateArticleOpenRequest();
    const actionKey = "new-article"; // 本次编辑器准备的展示键。
    const actionOwner = beginRouteAction(actionKey); // 本次调用的唯一持有者标识。
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

  /** 加载编辑草稿与标签，过期请求不再切换页面。 */
  async function editArticle(slug: string) {
    if (editingArticleSlug) {
      return;
    }

    invalidateArticleOpenRequest();
    const actionOwner = routeActionOwnerRef.current + 1; // 本次编辑器加载调用的唯一持有者标识。
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

  /** 复制文章标题及其当前 URL，必要时保留密码查询参数。 */
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

  /** 尝试使用解锁对话框中当前输入的密码。 */
  async function submitArticlePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordPrompt) {
      return;
    }

    await loadArticle(passwordPrompt.slug, true, passwordPrompt.value);
  }

  /** 保存文章并切换到详情，同时阻止重复提交。 */
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

  /** 确认后将文章移入回收站，并同步列表与详情状态。 */
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

  /** 切换文章的置顶状态，并刷新当前列表排序。 */
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

  /** 完成管理员登录，并刷新登录后可见的文章列表。 */
  async function handleLogin(username: string, password: string) {
    setError("");
    await login(username, password);
    setAuthenticated(true);
    setLoginOpen(false);
    setMessage("已登录");
    await Promise.all([refreshContent(), refreshDeletedArticles()]);
  }

  /** 退出管理员会话，清除管理状态并返回公开文章列表。 */
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
      guestbook.resetDraft();
      setActiveArticle(null);
      setEditingSlug(null);
      clearDeletedArticles();
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

  const isHomeHero = view === "list" && window.location.pathname === "/" && homeShowingHero; // 根路由当前处于全屏序章状态。

  return (
    <div className={view === "editor" ? "app-shell app-shell-editor" : view === "list" || view === "trash" ? `app-shell app-shell-archive${archiveTransitioning ? " archive-covering" : ""}` : "app-shell"}>
      {archiveTransitioning && (
        <div className="transition-hero-underlay" aria-hidden="true">
          <HeroLanding articleCount={allArticleTotal} tagCount={tags.length} backgroundUrl={homeBackground} onEnter={() => undefined} onGuestbook={() => undefined} />
        </div>
      )}
      {archiveTransitioning && <div className="archive-cover-surface" aria-hidden="true" />}
      {!isHomeHero && <SiteHeader
        authenticated={authenticated}
        showHomeButton={view === "list" && !homeShowingHero && window.location.pathname === "/"}
        showNewArticle={view !== "editor"}
        routeAction={routeAction}
        authAction={authAction}
        statisticsDisabled={Boolean(routeAction || editingArticleSlug || articleSubmitting || articleDeleting)}
        onShowList={() => showList()}
        onReturnHomeHero={returnToHomeHero}
        onStatistics={showStatistics}
        onGuestbook={showGuestbook}
        onNewArticle={newArticle}
        onLogout={handleLogout}
        onLogin={() => setLoginOpen(true)}
      />}

      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {message && <Status tone="success" text={message} onClose={() => setMessage("")} />}
        {notice && <Status tone="info" text={notice} onClose={() => setNotice("")} />}
        {error && <Status tone="error" text={error} onClose={() => setError("")} />}
      </div>

      <main
        className={
          isHomeHero
            ? "home-hero-main"
            : view === "list" || view === "trash"
            ? view === "list" && !homeShowingHero ? "layout archive-stage" : "layout"
            : view === "editor"
              ? "layout layout-detail layout-editor"
              : "layout layout-detail"
        }
      >
        {isHomeHero ? (
          <HeroLanding articleCount={allArticleTotal} tagCount={tags.length} backgroundUrl={homeBackground} onEnter={enterArticleList} onGuestbook={() => void showGuestbook()} />
        ) : <>

        {(view === "list" || view === "trash") && (
          <ArticleSidebar
            search={search}
            tags={tags}
            selectedTag={selectedTag}
            loading={loading}
            loadingMore={loadingMore}
            allArticleTotal={allArticleTotal}
            untaggedArticleTotal={untaggedArticleTotal}
            authenticated={authenticated}
            showingTrash={view === "trash"}
            trashLoading={trashLoading}
            deletedArticleTotal={deletedArticleTotal}
            trashDisabled={Boolean(routeAction || editingArticleSlug || articleSubmitting || articleDeleting)}
            onSearchChange={setSearch}
            onNotice={setNotice}
            onSelectTag={selectArticleTag}
            onTrash={showTrash}
          />
        )}

        <section className="content-area" ref={contentAreaRef}>
          {view === "list" && (
            <div id="article-list-anchor">
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
            </div>
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
            <div id="article-detail-anchor">
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
                <Guestbook mode="article" {...guestbook.props} />
              }
              />
            </div>
          )}

          {view === "editor" && authenticated && (
            <Editor
              key={editingSlug ?? "new-article"}
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
            <Guestbook mode="guestbook" {...guestbook.props} />
          )}
        </section>
        </>}
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
