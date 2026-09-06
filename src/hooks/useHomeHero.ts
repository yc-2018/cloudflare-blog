import { useEffect, useRef, useState } from "react";
import { homeBackgrounds } from "../config/home";
import { articlesHash } from "../navigation";

/** 为本次浏览器会话随机选取一张已配置的首屏背景图。 */
function selectHomeBackground() {
  return homeBackgrounds[Math.floor(Math.random() * homeBackgrounds.length)] ?? "/hero-night.jpg";
}

/** 管理首页背景、进入文章的手势与过渡动画。 */
export function useHomeHero({ isListView, showList }: {
  isListView: boolean;
  showList: () => void;
}) {
  const [homeShowingHero, setHomeShowingHero] = useState(() => window.location.hash !== articlesHash); // 根路由是否正在展示影院式首屏。
  const [homeBackground, setHomeBackground] = useState(selectHomeBackground); // 本次首屏访问所使用的背景图。
  const [archiveTransitioning, setArchiveTransitioning] = useState(false); // 归档层是否正在覆盖影院式首屏。
  const archiveTransitionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.pathname === "/" && isListView) {
        setHomeShowingHero(window.location.hash !== articlesHash);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [isListView]);

  useEffect(() => {
    if (!isListView || window.location.pathname !== "/" || !homeShowingHero) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY > 0) {
        event.preventDefault();
        enterArticleList();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (["ArrowDown", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        enterArticleList();
      }
    };
    let touchStartY = 0; // 首屏滑动手势的起始纵坐标。
    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY ?? touchStartY;
      if (touchStartY - currentY > 18) {
        event.preventDefault();
        enterArticleList();
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, [homeShowingHero, isListView]);

  /** 从影院式根首屏切换到文章列表，并记录可收藏的哈希。 */
  function enterArticleList() {
    if (!isListView || window.location.pathname !== "/") {
      showList();
      return;
    }

    if (archiveTransitionTimerRef.current !== null) {
      window.clearTimeout(archiveTransitionTimerRef.current);
    }
    setArchiveTransitioning(true);
    setHomeShowingHero(false);
    window.history.replaceState(null, "", `/${articlesHash}`);
    window.scrollTo({ top: 0, behavior: "auto" });
    archiveTransitionTimerRef.current = window.setTimeout(() => {
      setArchiveTransitioning(false);
      archiveTransitionTimerRef.current = null;
    }, 620);
  }

  /** 从文章列表返回影院式根首屏，且不改变 pathname。 */
  function returnToHomeHero() {
    if (archiveTransitionTimerRef.current !== null) {
      window.clearTimeout(archiveTransitionTimerRef.current);
      archiveTransitionTimerRef.current = null;
    }
    setArchiveTransitioning(false);
    if (window.location.pathname !== "/") {
      showList();
    }

    setHomeShowingHero(true);
    setHomeBackground(selectHomeBackground());
    window.history.replaceState(null, "", "/");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  return {
    homeShowingHero, setHomeShowingHero, homeBackground, archiveTransitioning,
    enterArticleList, returnToHomeHero
  };
}
