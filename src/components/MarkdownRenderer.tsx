import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import React from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import { createPortal } from "react-dom";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { remarkHighlightMark } from "remark-highlight-mark";
import { Copy, Check, X } from "lucide-react";
import type { Options as RehypeSanitizeOptions } from "rehype-sanitize";

const minLightboxScale = 0.5; // 灯箱中允许的最小图片缩放比例。

const maxLightboxScale = 4; // 灯箱中允许的最大图片缩放比例。

const lightboxScaleStep = 0.001; // 每个滚轮增量单位对应的缩放变化量。

const lightboxDragThreshold = 4; // 点击转为拖拽前指针需要移动的像素数。

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
]; // 公开评论与回复中允许的轻量 Markdown 元素。

/** 将图片限制为 HTTPS，同时应用 Markdown 库的安全链接协议过滤。 */
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

// 组件映射必须保持同一个引用：新的函数引用会被 React 当成新组件类型，从而重建 <img> 节点并让图片重新加载。
const commentMarkdownComponents: Components = {
  a: ({ node: _node, ...linkProps }) => <a {...linkProps} target="_blank" rel="noopener noreferrer" />,
  img: ({ node: _node, ...imageProps }) => (
    <img {...imageProps} className="comment-image" loading="lazy" referrerPolicy="no-referrer" />
  )
};

/** 渲染轻量的评论 Markdown，同时拒绝 HTML、标题、表格和不安全的图片。 */
export function CommentContent(props: { content: string }) {
  return (
    <div className="message-content">
      <ReactMarkdown
        allowedElements={commentMarkdownElements}
        remarkPlugins={[remarkGfm, remarkSoftLineBreaks]}
        skipHtml
        unwrapDisallowed
        urlTransform={transformCommentUrl}
        components={commentMarkdownComponents}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  );
}

/** 渲染经过安全过滤的文章 Markdown，并提供代码复制和图片灯箱。 */
export function MarkdownRenderer(props: { content: string }) {
  const [lightboxImage, setLightboxImage] = useState<MarkdownImageData | null>(null); // 当前放大的 Markdown 图片。
  const [lightboxScale, setLightboxScale] = useState(1); // 当前灯箱图片的缩放比例。
  const [lightboxOffset, setLightboxOffset] = useState({ x: 0, y: 0 }); // 当前图片的拖拽偏移量。
  const lightboxDragRef = useRef<LightboxDragState | null>(null); // 当前进行中的指针拖拽状态。
  const suppressLightboxClickRef = useRef(false); // 防止拖拽松开时误关闭图片。

  /** 打开一张 Markdown 图片并重置其缩放级别。 */
  const openLightboxImage = useCallback((image: MarkdownImageData) => {
    setLightboxImage(image);
    setLightboxScale(1);
    setLightboxOffset({ x: 0, y: 0 });
    suppressLightboxClickRef.current = false;
  }, []);

  /** 关闭灯箱并恢复其默认缩放级别。 */
  const closeLightbox = useCallback(() => {
    setLightboxImage(null);
    setLightboxScale(1);
    setLightboxOffset({ x: 0, y: 0 });
    lightboxDragRef.current = null;
    suppressLightboxClickRef.current = false;
  }, []);

  /** 应用鼠标滚轮缩放，同时将图片缩放比例保持在安全范围内。 */
  const handleLightboxWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextScale = Math.min(maxLightboxScale, Math.max(minLightboxScale, lightboxScale - event.deltaY * lightboxScaleStep)); // 本次滚轮事件后的缩放比例。
    setLightboxScale(nextScale);
    if (nextScale <= 1) {
      setLightboxOffset({ x: 0, y: 0 });
    }
  }, [lightboxScale]);

  /** 当放大图片超出其原始尺寸时，开始拖拽。 */
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

  /** 在指针按住期间移动放大的图片。 */
  const handleLightboxPointerMove = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const drag = lightboxDragRef.current; // 当前指针拖拽状态。
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX; // 指针的水平移动量。
    const deltaY = event.clientY - drag.startY; // 指针的垂直移动量。
    if (!drag.moved && Math.hypot(deltaX, deltaY) < lightboxDragThreshold) {
      return;
    }

    drag.moved = true;
    setLightboxOffset({ x: drag.originX + deltaX, y: drag.originY + deltaY });
  }, []);

  /** 结束图片拖拽，并抑制移动后产生的合成点击事件。 */
  const handleLightboxPointerUp = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const drag = lightboxDragRef.current; // 当前指针拖拽状态。
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    lightboxDragRef.current = null;
    if (typeof event.currentTarget.hasPointerCapture === "function" && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    suppressLightboxClickRef.current = drag.moved;
  }, []);

  /** 在简单点击图片时关闭预览，同时保留已完成的拖拽。 */
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

    const previousBodyOverflow = document.body.style.overflow; // 关闭预览后需要恢复的 body overflow 值。
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

  // 组件映射必须保持同一个引用：新的函数引用会被 React 当成新组件类型，从而重建 <img> 节点并让图片重新加载。
  const markdownComponents = useMemo<Components>(
    () => ({
      a: ({ children, node: _node, ...anchorProps }) => (
        <a {...anchorProps} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
      img: ({ node: _node, ...imageProps }) => <MarkdownImage {...imageProps} onOpen={openLightboxImage} />,
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
    }),
    [openLightboxImage]
  );

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkSoftLineBreaks, remarkHighlightMark, remarkHighlightMarkElement]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], [rehypeHighlight, { detect: true }]]}
        components={markdownComponents}
      >
        {props.content}
      </ReactMarkdown>
      {lightboxImage &&
        createPortal(
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
          </div>,
          document.body
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

/** 渲染一张 Markdown 图片，可在无障碍的全屏预览中打开。 */
const MarkdownImage = React.memo(function MarkdownImage(props: MarkdownImageProps) {
  const alt = props.alt ?? ""; // 图片无法加载时显示的替代文本。
  const src = props.src ?? ""; // Markdown 图片的源 URL。

  if (!src) {
    return <img alt={alt} title={props.title} />;
  }

  /** 在父级 Markdown 灯箱中打开这张图片。 */
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
      <img src={src} alt={alt} title={props.title} loading="lazy" />
    </span>
  );
});

interface MarkdownAstNode {
  type?: string;
  data?: Record<string, unknown>;
  value?: string;
  children?: MarkdownAstNode[];
}

/** 将 Markdown 软换行转换为显式的 break 节点，同时不改动代码块。 */
function remarkSoftLineBreaks() {
  return (tree: MarkdownAstNode) => {
    /** 重写包含换行符的文本子节点，并递归遍历嵌套的 Markdown 内容。 */
    const visit = (node: MarkdownAstNode) => {
      if (!node.children) {
        return;
      }

      const nextChildren: MarkdownAstNode[] = []; // 已将软换行替换为 break 节点的子节点集合。
      node.children.forEach((child) => {
        if (child.type === "text" && child.value?.includes("\n")) {
          const lines = child.value.split("\n"); // 按源文本换行符拆分出的文本片段。
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

/** 将该插件的 highlight 节点映射为供 rehype 使用的安全 mark 元素。 */
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

/** 渲染带语言标识和复制按钮的代码块。 */
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

  /** 复制代码纯文本，并短暂展示复制结果。 */
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

/** 递归提取代码节点中的纯文本供剪贴板复制。 */
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
