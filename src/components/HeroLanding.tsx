import { useState, type CSSProperties } from "react";
import { ArrowDown, ArrowRight, MessageSquareText, PanelRightOpen, Sparkles } from "lucide-react";
import { homeDanmaku } from "../config/home";

/** 生成随机的初始相位与速度，使每条弹幕轨道都有可见的起始位置并能无缝循环。 */
function createDanmakuEntryProfiles() {
  return Array.from({ length: 5 }, () => {
    const duration = 30 + Math.floor(Math.random() * 25); // 弹幕完整循环一次所需的秒数。
    const initialProgress = 0.16 + Math.random() * 0.18; // 初始循环进度让每条轨道明显错开。
    return {
      delay: -(duration * initialProgress),
      duration
    };
  });
}

/** 在访客进入文章档案前，渲染影院式的首页序章体验。 */
export function HeroLanding(props: {
  articleCount: number;
  tagCount: number;
  backgroundUrl: string;
  onEnter: () => void;
  onGuestbook: () => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false); // 悬浮探索面板是否展开。
  const [entryProfiles] = useState(createDanmakuEntryProfiles); // 本次首屏访问的随机入场顺序。

  return (
    <section className="hero-cinematic" aria-label="博客首页序章">
      <a
        href="https://github.com/yc-2018/cloudflare-blog"
        className="github-corner"
        aria-label="在 GitHub 查看项目源码"
        title="查看 GitHub 源码"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg width="80" height="80" viewBox="0 0 250 250" aria-hidden="true" focusable="false">
          <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z" />
          <path
            d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2"
            fill="currentColor"
            className="octo-arm"
          />
          <path
            d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z"
            fill="currentColor"
            className="octo-body"
          />
        </svg>
      </a>
      <div className="hero-cinematic-image" style={{ backgroundImage: `url("${props.backgroundUrl}")` }} aria-hidden="true" />
      <div className="hero-cinematic-shade" aria-hidden="true" />
      <div className="hero-cinematic-grid" aria-hidden="true" />
      <div className="hero-danmaku-panel" aria-hidden="true">
        <div className="hero-danmaku">
          {Array.from({ length: 5 }, (_, trackIndex) => {
            const trackLines = homeDanmaku.filter((_, lineIndex) => lineIndex % 5 === trackIndex); // 分配到这条滚动轨道的弹幕文案。
            const profile = entryProfiles[trackIndex] ?? { delay: -8, duration: 30 }; // 分配到这条轨道的入场参数。
            return (
              <div
                className="hero-danmaku-track"
                key={`track-${trackIndex}`}
                style={{ "--entry-delay": `${profile.delay}s`, "--entry-duration": `${profile.duration}s` } as CSSProperties}
              >
                {[0, 1].map((copyIndex) => (
                  <div className="hero-danmaku-group" key={`group-${copyIndex}`}>
                    {trackLines.map((line) => <span className="hero-danmaku-line" key={`${copyIndex}-${line}`}>{line}</span>)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="hero-cinematic-topline"><span>YC / 556</span><span>FIELD NOTES / 2026</span></div>
      <div className="hero-cinematic-copy">
        <div className="hero-cinematic-kicker"><Sparkles size={14} /> PERSONAL FIELD NOTES</div>
        <h1>潮生于<br /><em>无声处。</em></h1>
        <p className="hero-cinematic-lede">仰晨的边缘手记。代码、远方，以及一瞬的念头。</p>
        <div className="hero-cinematic-poem">
          <span>“</span>
          <p>欲买桂花同载酒，<br />终不似，少年游。</p>
          <small>— 刘过《唐多令·芦叶满汀洲》</small>
        </div>
      </div>
      <div className="hero-cinematic-meta"><span>{props.articleCount} ARTICLES / {props.tagCount} TOPICS</span><span>KEEP MOVING</span></div>
      <button className="hero-cinematic-enter" type="button" onClick={props.onEnter} aria-label="进入文章列表">
        <span>向下进入文章</span><ArrowDown size={18} />
      </button>
      <button
        className={panelOpen ? "hero-side-toggle is-open" : "hero-side-toggle"}
        type="button"
        onClick={() => setPanelOpen((open) => !open)}
        aria-label={panelOpen ? "关闭探索菜单" : "打开探索菜单"}
        title={panelOpen ? "关闭探索菜单" : "探索"}
      >
        <PanelRightOpen size={20} />
      </button>
      <aside className={panelOpen ? "hero-side-panel is-open" : "hero-side-panel"} aria-hidden={!panelOpen}>
        <span className="hero-side-panel-label">EXPLORE / 556</span>
        <button type="button" onClick={props.onEnter}><span>文章档案</span><ArrowRight size={16} /></button>
        <button type="button" onClick={props.onGuestbook}><span>留下回声</span><MessageSquareText size={16} /></button>
        <div className="hero-side-panel-stats"><strong>{props.articleCount}</strong><small>篇已发布文字</small></div>
      </aside>
      <div className="hero-cinematic-scroll-hint"><span className="hero-scroll-line" /> SCROLL / WHEEL DOWN</div>
    </section>
  );
}
