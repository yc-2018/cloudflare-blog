import { ArrowUp, BarChart3, MessageSquareText, LogIn, LogOut, Plus } from "lucide-react";
import { ButtonSpinner } from "./Feedback";

/** 渲染站点导航，并按登录和异步操作状态启用入口。 */
export function SiteHeader({
  authenticated, showHomeButton, showNewArticle, routeAction, authAction, statisticsDisabled,
  onShowList: showList, onReturnHomeHero: returnToHomeHero, onStatistics: showStatistics,
  onGuestbook: showGuestbook, onNewArticle: newArticle, onLogout: handleLogout, onLogin
}: {
  authenticated: boolean;
  showHomeButton: boolean;
  showNewArticle: boolean;
  routeAction: string;
  authAction: string;
  statisticsDisabled: boolean;
  onShowList: () => void;
  onReturnHomeHero: () => void;
  onStatistics: () => void;
  onGuestbook: () => void;
  onNewArticle: () => void;
  onLogout: () => void;
  onLogin: () => void;
}) {
  return (
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
        {showHomeButton && (
          <button className="icon-button return-hero-topbar-button" type="button" onClick={returnToHomeHero} aria-label="返回首页序章" title="返回首页序章">
            <ArrowUp size={18} />
          </button>
        )}
        {authenticated && (
          <button
            className="text-button statistics-nav-button"
            type="button"
            onClick={() => showStatistics()}
            disabled={statisticsDisabled}
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
        {authenticated && showNewArticle && (
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
          <button className="text-button" type="button" onClick={() => onLogin()}>
            <LogIn size={16} />
            登录
          </button>
        )}
      </nav>
    </header>
  );
}
