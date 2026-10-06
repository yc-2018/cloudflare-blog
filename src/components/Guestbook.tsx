import React, { useEffect, useRef } from "react";
import { Bold, Code, Eye, EyeOff, Highlighter, Link, Quote, Strikethrough, Trash2 } from "lucide-react";
import type { GuestbookCaptcha, GuestbookInput, GuestbookMessage } from "../types";
import { formatDateTime } from "../utils";
import { ButtonSpinner, EmptyState } from "./Feedback";
import { CommentContent } from "./MarkdownRenderer";

/** 评论工具栏支持的行内 Markdown 语法：[前缀, 后缀, 无选区时的占位文字]。 */
const commentInlineFormats = {
  bold: ["**", "**", "加粗文字"],
  strikethrough: ["~~", "~~", "删除线文字"],
  highlight: ["==", "==", "高亮文字"],
  code: ["`", "`", "代码"],
  link: ["[", "](url)", "链接文字"]
} satisfies Record<string, [before: string, after: string, placeholder: string]>;

const quotePrefix = "> "; // 引用语法只有写在行首才会被解析。

const quotePlaceholder = "引用文字"; // 在空行插入引用时补入的示例文字。

/** 渲染留言板或文章评论的受控表单与留言列表。 */
export function Guestbook(props: {
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
  editingId: number | null;
  editContent: string;
  onCancelReply: () => void;
  onStatus: (id: number, status: "pending" | "approved", invalid: boolean) => void;
  onDelete: (id: number) => void;
  onEdit: (id: number, content: string) => void;
  onDraftChange: (draft: GuestbookInput) => void;
  onRefreshCaptcha: () => void;
  onReply: (message: GuestbookMessage) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onEditStart: (id: number, content: string) => void;
  onEditCancel: () => void;
  onEditContentChange: (content: string) => void;
}) {
  const canSubmit = props.authenticated || props.cooldown === 0;
  const articleMode = props.mode === "article";
  const contentFieldId = articleMode ? "article-comment-content" : "guestbook-content"; // 正文输入框的 id，供标签与工具栏关联。
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);

  /** 更新受控留言板草稿中的一个字段。 */
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
          <div className="guestbook-content-field">
            <div className="guestbook-content-heading">
              <label htmlFor={contentFieldId}>{articleMode ? "评论" : "留言"}</label>
              <CommentMarkdownToolbar
                label={articleMode ? "评论格式快捷按钮" : "留言格式快捷按钮"}
                maxLength={500}
                textareaRef={contentTextareaRef}
                onChange={(content) => setDraftField("content", content)}
              />
            </div>
            <textarea
              id={contentFieldId}
              ref={contentTextareaRef}
              required
              maxLength={500}
              rows={5}
              value={props.draft.content}
              onChange={(event) => setDraftField("content", event.target.value)}
              placeholder={articleMode ? "写下对这篇文章的想法" : "写下想说的话"}
            />
            <span className="field-hint">{props.draft.content.length}/500</span>
          </div>
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
              editingId={props.editingId}
              editContent={props.editContent}
              onStatus={props.onStatus}
              onDelete={props.onDelete}
              onReply={props.onReply}
              onEditStart={props.onEditStart}
              onEditCancel={props.onEditCancel}
              onEditContentChange={props.onEditContentChange}
              onEdit={props.onEdit}
            />
          ))}
      </section>
    </div>
  );
}

/** 评论输入框右上角的 Markdown 快捷按钮，包裹选区或在无选区时插入占位文字。 */
function CommentMarkdownToolbar(props: {
  label: string;
  maxLength: number;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (content: string) => void;
}) {
  /** 写入新正文，并在受控 value 被重设后恢复选区，否则浏览器会把光标推到文末。 */
  function applyContent(value: string, selectionStart: number, selectionEnd: number) {
    if (value.length > props.maxLength) {
      return; // 插入后会超出长度上限，放弃本次操作，避免正文被后端拒绝。
    }

    props.onChange(value);
    window.requestAnimationFrame(() => {
      const textarea = props.textareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  /** 在选区两侧插入包裹符号，无选区时插入占位文字并选中它。 */
  function wrapSelection([before, after, placeholder]: [string, string, string]) {
    const textarea = props.textareaRef.current;
    if (!textarea) {
      return;
    }

    const { selectionStart, selectionEnd, value } = textarea;
    const textToInsert = value.slice(selectionStart, selectionEnd) || placeholder; // 被包裹的文本，无选区时退化为占位文字。

    applyContent(
      `${value.slice(0, selectionStart)}${before}${textToInsert}${after}${value.slice(selectionEnd)}`,
      selectionStart + before.length,
      selectionStart + before.length + textToInsert.length
    );
  }

  /** 为选区覆盖的每一非空行加上引用前缀，光标停在空行时补入占位文字。 */
  function prefixQuoteLines() {
    const textarea = props.textareaRef.current;
    if (!textarea) {
      return;
    }

    const { selectionStart, selectionEnd, value } = textarea;
    const rangeEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd; // 选区以换行结尾时不把下一行算进来。
    const blockStart = value.lastIndexOf("\n", selectionStart - 1) + 1; // 选区首行的行首偏移。
    const lineBreak = value.indexOf("\n", rangeEnd);
    const blockEnd = lineBreak === -1 ? value.length : lineBreak; // 选区末行的行尾偏移。
    const block = value.slice(blockStart, blockEnd);

    if (!block.trim()) {
      // 空行上只加前缀会留下一个孤立的 ">"，因此补上占位文字并选中它。
      applyContent(
        `${value.slice(0, blockStart)}${quotePrefix}${quotePlaceholder}${value.slice(blockEnd)}`,
        blockStart + quotePrefix.length,
        blockStart + quotePrefix.length + quotePlaceholder.length
      );
      return;
    }

    const quoted = block
      .split("\n")
      .map((line) => (line.trim() ? `${quotePrefix}${line}` : line))
      .join("\n");

    applyContent(`${value.slice(0, blockStart)}${quoted}${value.slice(blockEnd)}`, blockStart, blockStart + quoted.length);
  }

  return (
    <div className="guestbook-toolbar" role="group" aria-label={props.label}>
      <button className="toolbar-button" type="button" onClick={() => wrapSelection(commentInlineFormats.bold)} title="加粗" aria-label="加粗">
        <Bold size={14} />
      </button>
      <button
        className="toolbar-button"
        type="button"
        onClick={() => wrapSelection(commentInlineFormats.strikethrough)}
        title="删除线"
        aria-label="删除线"
      >
        <Strikethrough size={14} />
      </button>
      <button
        className="toolbar-button"
        type="button"
        onClick={() => wrapSelection(commentInlineFormats.highlight)}
        title="高亮文本"
        aria-label="高亮文本"
      >
        <Highlighter size={14} />
      </button>
      <button className="toolbar-button" type="button" onClick={() => wrapSelection(commentInlineFormats.code)} title="行内代码" aria-label="行内代码">
        <Code size={14} />
      </button>
      <button className="toolbar-button" type="button" onClick={() => wrapSelection(commentInlineFormats.link)} title="链接" aria-label="链接">
        <Link size={14} />
      </button>
      <button className="toolbar-button" type="button" onClick={prefixQuoteLines} title="引用" aria-label="引用">
        <Quote size={14} />
      </button>
    </div>
  );
}

/** 展示顶层留言及管理员编辑、审核和回复操作。 */
function GuestbookMessageItem(props: {
  action: string;
  authenticated: boolean;
  message: GuestbookMessage;
  editingId: number | null;
  editContent: string;
  onStatus: (id: number, status: "pending" | "approved", invalid: boolean) => void;
  onDelete: (id: number) => void;
  onReply: (message: GuestbookMessage) => void;
  onEditStart: (id: number, content: string) => void;
  onEditCancel: () => void;
  onEditContentChange: (content: string) => void;
  onEdit: (id: number, content: string) => void;
}) {
  const deleteActionKey = `delete-${props.message.id}`;
  const statusChanging = props.action === `status-${props.message.id}`;
  const deleting = props.action === deleteActionKey;
  const actionBusy = Boolean(props.action);
  const isEditing = props.authenticated && props.editingId === props.message.id;

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
          {props.authenticated && !isEditing && (
            <button
              className="text-button ghost"
              type="button"
              onClick={() => props.onEditStart(props.message.id, props.message.content)}
              disabled={actionBusy}
            >
              编辑
            </button>
          )}
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
      {isEditing ? (
        <MessageEditForm
          messageId={props.message.id}
          content={props.editContent}
          action={props.action}
          onChange={props.onEditContentChange}
          onCancel={props.onEditCancel}
          onSave={props.onEdit}
        />
      ) : (
        <CommentContent content={props.message.content} />
      )}
      {props.message.replies.length > 0 && (
        <div className="message-replies">
          {props.message.replies.map((reply) => (
            <GuestbookReplyItem
              action={props.action}
              authenticated={props.authenticated}
              key={reply.id}
              reply={reply}
              editingId={props.editingId}
              editContent={props.editContent}
              onStatus={props.onStatus}
              onDelete={props.onDelete}
              onReply={props.onReply}
              onEditStart={props.onEditStart}
              onEditCancel={props.onEditCancel}
              onEditContentChange={props.onEditContentChange}
              onEdit={props.onEdit}
            />
          ))}
        </div>
      )}
    </article>
  );
}

/** 展示一条回复及其可见性和编辑状态。 */
function GuestbookReplyItem(props: {
  action: string;
  authenticated: boolean;
  reply: GuestbookMessage;
  editingId: number | null;
  editContent: string;
  onStatus: (id: number, status: "pending" | "approved", invalid: boolean) => void;
  onDelete: (id: number) => void;
  onReply: (message: GuestbookMessage) => void;
  onEditStart: (id: number, content: string) => void;
  onEditCancel: () => void;
  onEditContentChange: (content: string) => void;
  onEdit: (id: number, content: string) => void;
}) {
  const deleteActionKey = `delete-${props.reply.id}`;
  const statusChanging = props.action === `status-${props.reply.id}`;
  const deleting = props.action === deleteActionKey;
  const actionBusy = Boolean(props.action);
  const isEditing = props.authenticated && props.editingId === props.reply.id;

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
          {props.authenticated && !isEditing && (
            <button
              className="text-button ghost"
              type="button"
              onClick={() => props.onEditStart(props.reply.id, props.reply.content)}
              disabled={actionBusy}
            >
              编辑
            </button>
          )}
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
      {isEditing ? (
        <MessageEditForm
          messageId={props.reply.id}
          content={props.editContent}
          action={props.action}
          onChange={props.onEditContentChange}
          onCancel={props.onEditCancel}
          onSave={props.onEdit}
        />
      ) : (
        <CommentContent content={props.reply.content} />
      )}
    </article>
  );
}

/** 共用主评论与回复的编辑表单，仅在进入编辑时将光标移到正文末尾。 */
function MessageEditForm(props: {
  messageId: number;
  content: string;
  action: string;
  onChange: (content: string) => void;
  onCancel: () => void;
  onSave: (id: number, content: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = Boolean(props.action); // 提交完成前冻结草稿，避免后续输入被成功回调清除。
  const saving = props.action === `edit-${props.messageId}`;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.scrollTop = textarea.scrollHeight;
  }, []);

  return (
    <div className="message-edit-form">
      <textarea
        ref={textareaRef}
        aria-label="编辑评论内容"
        value={props.content}
        onChange={(event) => props.onChange(event.target.value)}
        maxLength={500}
        rows={5}
        disabled={busy}
      />
      <div className="message-edit-actions">
        <button className="text-button ghost" type="button" onClick={props.onCancel} disabled={busy}>
          取消
        </button>
        <button
          className="text-button primary"
          type="button"
          onClick={() => props.onSave(props.messageId, props.content)}
          disabled={busy || !props.content.trim()}
        >
          {saving && <ButtonSpinner />}
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}

/** 显示留言和回复加载时的占位布局。 */
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
