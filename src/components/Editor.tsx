import { useEffect, useRef, useState } from "react";
import React from "react";
import { ImageIcon, Keyboard } from "lucide-react";
import type { ArticleInput, Tag as TagType } from "../types";
import { excerptFromContent } from "../utils";
import {
  convertStandaloneImageLinks,
  imageHostLabels,
  markdownImage,
  prepareCoverImageForUpload,
  prepareImageForUpload,
  rehostImageWithFallback,
  uploadImageWithFallback
} from "../imageUpload";
import { parsePastedHtml, type PastedContent } from "../htmlPaste";
import { ButtonSpinner } from "./Feedback";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { EditorShortcutsDialog, TagSelector, SegmentedVisibility } from "./EditorControls";
import { asErrorMessage } from "../utils";

/** Ctrl/Cmd 快捷键到 Markdown 包裹语法的映射：[前缀, 后缀, 无选区时的占位符]。 */
const markdownShortcuts: Record<string, [before: string, after: string, placeholder: string]> = {
  b: ["**", "**", "加粗文字"],
  i: ["*", "*", "斜体文字"],
  k: ["[", "](url)", "链接文字"]
};

/** 选中文本后按下这些符号时，用符号包裹选区而不是替换选区。 */
const wrapPairs: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
  "*": "*",
  _: "_"
};

/**
 * 必须写在行首才生效的 Markdown 语法：prefix 按选区内非空行的序号生成前缀，
 * placeholder 用于光标停在空行时补入的示例文字。
 */
const linePrefixFormats: Record<string, { prefix: (ordinal: number) => string; placeholder: string }> = {
  h1: { prefix: () => "# ", placeholder: "一级标题" },
  h2: { prefix: () => "## ", placeholder: "二级标题" },
  h3: { prefix: () => "### ", placeholder: "三级标题" },
  quote: { prefix: () => "> ", placeholder: "引用文字" },
  ul: { prefix: () => "- ", placeholder: "列表项" },
  ol: { prefix: (ordinal) => `${ordinal}. `, placeholder: "列表项" }
};

/** 可以直接包裹选区、不受所在行位置影响的行内 Markdown 语法。 */
const inlineFormats: Record<string, [before: string, after: string, placeholder: string]> = {
  bold: ["**", "**", "加粗文字"],
  italic: ["*", "*", "斜体文字"],
  code: ["`", "`", "代码"],
  link: ["[", "](url)", "链接文字"]
};

/** 管理文章草稿输入、Markdown 快捷编辑、图片上传与实时预览。 */
export function Editor(props: {
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
  const [autoExcerpt, setAutoExcerpt] = useState(() => !props.draft.excerpt.trim()); // 摘要是否跟随文章正文自动生成。
  const [shortcutsOpen, setShortcutsOpen] = useState(false); // 是否展开编辑器快捷键说明弹窗。
  const draftRef = useRef(props.draft);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    draftRef.current = props.draft;
  }, [props.draft]);

  useEffect(() => {
    if (autoExcerpt && !props.draft.excerpt.trim()) {
      const generatedExcerpt = excerptFromContent(props.draft.content);
      if (generatedExcerpt) {
        updateDraft({ ...props.draft, excerpt: generatedExcerpt });
      }
    }
  }, [autoExcerpt]);

  /** 更新草稿及其供异步上传使用的同步 ref。 */
  function updateDraft(nextDraft: ArticleInput) {
    draftRef.current = nextDraft;
    props.onDraftChange(nextDraft);
  }

  /** 以最新草稿为基础更新单个字段，保留异步上传期间的输入。 */
  const setField = <Key extends keyof ArticleInput>(key: Key, value: ArticleInput[Key]) => {
    updateDraft({ ...draftRef.current, [key]: value });
  };

  /** 上传粘贴的图片，并将其 URL 写入列表图片字段。 */
  async function uploadCoverImage(file: File) {
    if (uploadingTarget) {
      props.onError("请等待当前图片上传完成");
      return;
    }

    setUploadingTarget("cover");
    try {
      const prepared = await prepareCoverImageForUpload(file);
      const result = await uploadImageWithFallback(prepared.file);
      setField("coverImageUrl", result.url);
      props.onNotice(`${prepared.optimized ? `封面已压缩${prepared.convertedToWebp ? "并转为 WebP" : ""}，` : ""}图片已上传到 ${imageHostLabels[result.provider]}`);
    } catch (error) {
      props.onError(asErrorMessage(error));
    } finally {
      setUploadingTarget("");
    }
  }

  /**
   * 还原正文文本域的选区与滚动位置。
   * React 重设受控 value 后浏览器会把光标推到文末并滚动过去，必须在下一帧重新指定。
   */
  function restoreContentSelection(scrollTop: number, selectionStart: number, selectionEnd = selectionStart, refocus = true) {
    window.requestAnimationFrame(() => {
      const textarea = contentTextareaRef.current;
      if (!textarea) {
        return;
      }
      if (refocus) {
        textarea.focus(); // focus() 会滚动到当前光标，因此必须放在还原 scrollTop 之前。
      }
      textarea.setSelectionRange(selectionStart, selectionEnd);
      textarea.scrollTop = scrollTop;
    });
  }

  /** 把正文里的上传占位标记替换成最终内容，并保持用户当前的光标与滚动位置。 */
  function replaceUploadMarker(marker: string, replacement: string) {
    const content = draftRef.current.content;
    const markerIndex = content.indexOf(marker); // 占位标记的位置，上传期间用户可能已在别处继续编辑。
    if (markerIndex < 0) {
      return;
    }

    const textarea = contentTextareaRef.current;
    const scrollTop = textarea?.scrollTop ?? 0;
    const caret = textarea?.selectionStart ?? markerIndex + marker.length; // 替换前用户所在的光标位置。
    const caretAfter =
      caret <= markerIndex
        ? caret // 光标在标记之前，位置不受影响。
        : caret >= markerIndex + marker.length
          ? caret + replacement.length - marker.length // 替换发生在光标之前，按长度差平移。
          : markerIndex + replacement.length; // 光标原本落在标记内部，移到替换后的内容末尾。
    const active = document.activeElement; // 上传期间正文文本域被禁用，用户可能已切换到其它输入框，此时不应抢回焦点。

    handleContentChange(`${content.slice(0, markerIndex)}${replacement}${content.slice(markerIndex + marker.length)}`);
    restoreContentSelection(scrollTop, caretAfter, caretAfter, !active || active === document.body || active === textarea);
  }

  /** 插入一个临时的 Markdown 占位标记，并在上传完成后替换为图片 URL。 */
  async function uploadContentImage(file: File, selectionStart: number, selectionEnd: number) {
    if (uploadingTarget) {
      props.onError("请等待当前图片上传完成");
      return;
    }

    const markerId = `uploading-${crypto.randomUUID()}`; // 在异步状态更新过程中保持唯一的占位标记。
    const marker = markdownImage(markerId, "图片上传中…");
    const content = draftRef.current.content;
    const scrollTop = contentTextareaRef.current?.scrollTop ?? 0; // 插入占位标记会重设 value，先记住原滚动位置。
    updateDraft({ ...draftRef.current, content: `${content.slice(0, selectionStart)}${marker}${content.slice(selectionEnd)}` });
    restoreContentSelection(scrollTop, selectionStart + marker.length);
    setUploadingTarget("content");

    try {
      const prepared = await prepareImageForUpload(file);
      const result = await uploadImageWithFallback(prepared.file);
      replaceUploadMarker(marker, markdownImage(result.url));
      props.onNotice(`${prepared.convertedToWebp ? "已转为 WebP，" : ""}图片已上传到 ${imageHostLabels[result.provider]}`);
    } catch (error) {
      replaceUploadMarker(marker, "");
      props.onError(asErrorMessage(error));
    } finally {
      setUploadingTarget("");
    }
  }

  /** 从封面输入框的剪贴板中捕获图片，同时不影响正常的文本粘贴。 */
  function handleCoverPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const image = clipboardImage(event.clipboardData);
    if (!image) {
      return;
    }
    event.preventDefault();
    void uploadCoverImage(image);
  }

  /** 从 Markdown 文本域中捕获图片，并记住其插入位置。 */
  function handleContentPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const image = clipboardImage(event.clipboardData);
    if (image) {
      event.preventDefault();
      void uploadContentImage(image, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
      return;
    }

    const html = event.clipboardData.getData("text/html");
    if (!html) {
      return;
    }

    const parsed = parsePastedHtml(html, () => markdownImage(`uploading-${crypto.randomUUID()}`, "图片上传中…"));
    if (parsed.images.length === 0) {
      return; // 不含图片时交给浏览器执行默认的纯文本粘贴，保留撤销历史。
    }

    event.preventDefault();
    if (uploadingTarget) {
      props.onError("请等待当前图片上传完成");
      return;
    }
    void pasteHtmlWithImages(parsed, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
  }

  /** 粘贴带图片的富文本：先插入正文与占位标记，再逐张把图片转存到项目图床。 */
  async function pasteHtmlWithImages(parsed: PastedContent, selectionStart: number, selectionEnd: number) {
    const content = draftRef.current.content;
    updateContent(`${content.slice(0, selectionStart)}${parsed.text}${content.slice(selectionEnd)}`, selectionStart + parsed.text.length);

    setUploadingTarget("content");
    let rehostedCount = 0; // 成功转存到项目图床的图片数量。
    try {
      for (const image of parsed.images) {
        let finalUrl = image.sourceUrl; // 转存失败时退回原始外链，至少不丢图。
        try {
          finalUrl = (await rehostImageWithFallback(image.sourceUrl)).url;
          rehostedCount += 1;
        } catch {
          // 单张图片转存失败不应中断整篇文章的粘贴。
        }
        replaceUploadMarker(image.marker, markdownImage(finalUrl));
      }
    } finally {
      setUploadingTarget("");
    }

    const failedCount = parsed.images.length - rehostedCount; // 仍然使用原始外链的图片数量。
    props.onNotice(
      failedCount === 0
        ? `已粘贴正文，并转存 ${rehostedCount} 张图片`
        : `已粘贴正文，${rehostedCount} 张图片已转存，${failedCount} 张转存失败仍使用原始链接`
    );
  }

  /** 将正文中单独成行的图片 URL 转换为 Markdown 图片。 */
  function convertImageLinks() {
    const result = convertStandaloneImageLinks(draftRef.current.content);
    if (result.convertedCount === 0) {
      props.onNotice("未识别到可转换的图片链接");
      return;
    }

    handleContentChange(result.content);
    props.onNotice(`已将 ${result.convertedCount} 个图片链接转为 Markdown`);
    window.requestAnimationFrame(() => contentTextareaRef.current?.focus());
  }

  /** 手动更新摘要，并禁用基于正文的自动生成。 */
  function handleExcerptChange(value: string) {
    setAutoExcerpt(false);
    setField("excerpt", value);
  }

  /** 在自动模式启用时，保持生成的摘要同步更新。 */
  function handleContentChange(value: string) {
    const nextDraft = { ...draftRef.current, content: value };
    if (autoExcerpt) {
      nextDraft.excerpt = excerptFromContent(value);
    }
    updateDraft(nextDraft);
  }

  /** 处理 Markdown 编辑快捷键：加粗、斜体、链接，以及成对符号包裹选区。 */
  function handleContentKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;
    const hasSelection = textarea.selectionStart !== textarea.selectionEnd; // 是否存在待包裹的选区。

    if (event.ctrlKey || event.metaKey) {
      const shortcut = markdownShortcuts[event.key.toLowerCase()];
      if (shortcut) {
        event.preventDefault();
        wrapSelection(shortcut[0], shortcut[1], shortcut[2]);
      }
      return;
    }

    // 选中文本后按下成对符号时包裹选区，而不是替换掉选中内容。
    if (hasSelection && !event.altKey && wrapPairs[event.key]) {
      event.preventDefault();
      wrapSelection(event.key, wrapPairs[event.key], "");
    }
  }

  /** 更新正文，并在受控 value 被重设后恢复选区与滚动位置。 */
  function updateContent(value: string, selectionStart: number, selectionEnd = selectionStart) {
    const scrollTop = contentTextareaRef.current?.scrollTop ?? 0; // 必须在触发重新渲染之前读取。
    handleContentChange(value);
    restoreContentSelection(scrollTop, selectionStart, selectionEnd);
  }

  /** 在选区两侧插入包裹符号，无选区时插入占位符并选中它。 */
  function wrapSelection(before: string, after: string, placeholder: string) {
    const textarea = contentTextareaRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd, value } = textarea;
    const selectedText = value.slice(selectionStart, selectionEnd);
    const textToInsert = selectedText || placeholder; // 被包裹的文本，无选区时退化为占位符。

    updateContent(
      `${value.slice(0, selectionStart)}${before}${textToInsert}${after}${value.slice(selectionEnd)}`,
      selectionStart + before.length,
      selectionStart + before.length + textToInsert.length
    );
  }

  /**
   * 为选区覆盖的每一整行添加行首前缀（标题、引用、列表）。
   * 前缀写在行中间不会被 Markdown 解析，因此始终从行首开始；空行会被跳过，避免生成空列表项。
   */
  function prefixLines(createPrefix: (ordinal: number) => string, placeholder: string) {
    const textarea = contentTextareaRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd, value } = textarea;
    const rangeEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd; // 选区以换行结尾时不把下一行算进来。
    const blockStart = value.lastIndexOf("\n", selectionStart - 1) + 1; // 选区首行的行首偏移。
    const lineBreak = value.indexOf("\n", rangeEnd);
    const blockEnd = lineBreak === -1 ? value.length : lineBreak; // 选区末行的行尾偏移。
    const block = value.slice(blockStart, blockEnd);

    if (!block.trim()) {
      // 光标停在空行时补上占位文字并选中，否则只会留下一个孤立的行首符号。
      const prefix = createPrefix(1);
      updateContent(
        `${value.slice(0, blockStart)}${prefix}${placeholder}${value.slice(blockEnd)}`,
        blockStart + prefix.length,
        blockStart + prefix.length + placeholder.length
      );
      return;
    }

    let ordinal = 0; // 选区内非空行的序号，供有序列表编号。
    const prefixed = block
      .split("\n")
      .map((line) => (line.trim() ? `${createPrefix((ordinal += 1))}${line}` : line))
      .join("\n");

    updateContent(`${value.slice(0, blockStart)}${prefixed}${value.slice(blockEnd)}`, blockStart, blockStart + prefixed.length);
  }

  /**
   * 插入代码块。两侧围栏必须各自独占一行，否则开头的 ``` 不生效，
   * 结尾的 ``` 反而会被当成一个没有闭合的新代码块起点。
   */
  function insertCodeBlock() {
    const textarea = contentTextareaRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd, value } = textarea;
    const code = value.slice(selectionStart, selectionEnd) || "代码块"; // 被围栏包裹的代码，无选区时退化为占位符。
    const leading = selectionStart === 0 || value[selectionStart - 1] === "\n" ? "" : "\n"; // 光标不在行首时补一个换行。
    const trailing = selectionEnd === value.length || value[selectionEnd] === "\n" ? "" : "\n"; // 选区后面还有内容时补一个换行。
    const codeStart = selectionStart + leading.length + 4; // 越过补入的换行与 "```\n" 之后，代码正文的起始偏移。

    updateContent(
      `${value.slice(0, selectionStart)}${leading}\`\`\`\n${code}\n\`\`\`${trailing}${value.slice(selectionEnd)}`,
      codeStart,
      codeStart + code.length
    );
  }

  /** 按工具栏按钮插入对应的 Markdown 语法。 */
  function insertMarkdown(format: string) {
    const lineFormat = linePrefixFormats[format];
    if (lineFormat) {
      prefixLines(lineFormat.prefix, lineFormat.placeholder);
      return;
    }

    if (format === "codeblock") {
      insertCodeBlock();
      return;
    }

    const inlineFormat = inlineFormats[format];
    if (inlineFormat) {
      wrapSelection(inlineFormat[0], inlineFormat[1], inlineFormat[2]);
    }
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
              <span className="editor-field-label-row">
                <span>摘要</span>
                <span className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={autoExcerpt}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      if (enabled && draftRef.current.excerpt.trim()) {
                        setAutoExcerpt(false);
                        return;
                      }
                      setAutoExcerpt(enabled);
                      if (enabled) {
                        setField("excerpt", excerptFromContent(draftRef.current.content));
                      }
                    }}
                  />
                  取正文前 200 字
                </span>
              </span>
              <textarea
                maxLength={240}
                rows={3}
                value={props.draft.excerpt}
                onChange={(event) => handleExcerptChange(event.target.value)}
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
                  <div className="editor-toolbar">
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("h1")} title="一级标题" aria-label="一级标题">
                      H1
                    </button>
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("h2")} title="二级标题" aria-label="二级标题">
                      H2
                    </button>
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("h3")} title="三级标题" aria-label="三级标题">
                      H3
                    </button>
                    <span className="toolbar-divider" />
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("bold")} title="加粗 (Ctrl+B)" aria-label="加粗">
                      <strong>B</strong>
                    </button>
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("italic")} title="斜体 (Ctrl+I)" aria-label="斜体">
                      <em>I</em>
                    </button>
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("code")} title="行内代码" aria-label="行内代码">
                      {'<>'}
                    </button>
                    <span className="toolbar-divider" />
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("link")} title="链接 (Ctrl+K)" aria-label="链接">
                      🔗
                    </button>
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("quote")} title="引用" aria-label="引用">
                      "
                    </button>
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("ul")} title="无序列表" aria-label="无序列表">
                      •
                    </button>
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("ol")} title="有序列表" aria-label="有序列表">
                      1.
                    </button>
                    <button className="toolbar-button" type="button" onClick={() => insertMarkdown("codeblock")} title="代码块" aria-label="代码块">
                      {'{ }'}
                    </button>
                    <span className="toolbar-divider" />
                    <button
                      className="toolbar-button"
                      type="button"
                      onClick={() => setShortcutsOpen(true)}
                      title="快捷键说明"
                      aria-label="快捷键说明"
                    >
                      <Keyboard size={15} />
                    </button>
                  </div>
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
                onChange={(event) => handleContentChange(event.target.value)}
                onPaste={handleContentPaste}
                onKeyDown={handleContentKeyDown}
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
      {shortcutsOpen && <EditorShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </form>
  );
}

/** 如果粘贴内容中包含图片，则返回剪贴板中的第一张图片。 */
function clipboardImage(clipboardData: DataTransfer) {
  return Array.from(clipboardData.files).find((file) => file.type.startsWith("image/")) ?? null;
}

/** 为新设置的受保护文章生成一个四位字母数字密码。 */
function createDefaultArticlePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}
