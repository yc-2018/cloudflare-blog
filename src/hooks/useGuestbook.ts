import { useEffect, useRef, useState, type FormEvent } from "react";
import { createMessage, deleteMessage, getMessageCaptcha, listMessages, updateMessage, updateMessageStatus } from "../api";
import type { GuestbookCaptcha, GuestbookInput, GuestbookMessage } from "../types";
import { passwordQueryKey } from "../navigation";
import { asErrorMessage } from "../utils";

const guestbookCooldownKey = "guestbook:lastSentAt"; // 客户端访客冷却时间所用的本地存储键。

const guestbookPendingKey = "guestbook:pending"; // 存放待审核访客留言所用的本地存储键。

const adminDefaultNickname = "仰晨"; // 管理员写留言时显示的初始昵称。

const guestbookCooldownSeconds = 120; // 访客再次发送前必须等待的秒数。

const defaultGuestbookDraft: GuestbookInput = {
  nickname: "",
  email: "",
  content: "",
  parentId: null,
  captchaToken: "",
  captchaAnswer: ""
};

interface PendingGuestbookRecord {
  scope: string;
  message: GuestbookMessage;
}

/** 读取本地访客冷却的剩余秒数。 */
function readGuestbookCooldown() {
  const lastSentAt = Number(window.localStorage.getItem(guestbookCooldownKey) ?? 0); // 访客上一次在本地发送的时间戳。
  if (!lastSentAt) {
    return 0;
  }

  const elapsedSeconds = Math.floor((Date.now() - lastSentAt) / 1000); // 距最近一次本地发送已过去的秒数。
  return Math.max(0, guestbookCooldownSeconds - elapsedSeconds);
}

/** 从本地存储中读取归属于访客的待审核留言。 */
function readPendingGuestbookMessages(scope: string): PendingGuestbookRecord[] {
  try {
    const records = JSON.parse(window.localStorage.getItem(guestbookPendingKey) ?? "[]") as PendingGuestbookRecord[];
    return records.filter((record) => record?.scope === scope && Number.isInteger(record.message?.id));
  } catch {
    return [];
  }
}

/** 写入需保留的待审核留言记录，同时保留其他作用域的数据。 */
function writePendingGuestbookMessages(scope: string, scopeRecords: PendingGuestbookRecord[]) {
  try {
    const all = JSON.parse(window.localStorage.getItem(guestbookPendingKey) ?? "[]") as PendingGuestbookRecord[];
    const other = all.filter((record) => record.scope !== scope);
    window.localStorage.setItem(guestbookPendingKey, JSON.stringify([...other, ...scopeRecords]));
  } catch {
    // 在隐私受限的浏览器中，本地存储可能不可用。
  }
}

/** 将刚提交的访客留言加入其本地待审核队列。 */
function addPendingGuestbookMessage(scope: string, message: GuestbookMessage) {
  const records = readPendingGuestbookMessages(scope).filter((record) => record.message.id !== message.id);
  writePendingGuestbookMessages(scope, [...records, { scope, message }]);
}

/** 将两级留言树扁平化，以便在本地核对 ID。 */
function flattenGuestbookMessages(messages: GuestbookMessage[]) {
  return messages.flatMap((message) => [message, ...message.replies]);
}

/** 标记本地保留的留言行，让访客能看到其审核状态。 */
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

/** 共用留言板与文章评论的表单、审核、验证码和本地待审核状态。 */
export function useGuestbook({ authenticated, articleId, onError: setError, onMessage: setMessage }: {
  authenticated: boolean;
  articleId: number | null | undefined; // null 表示留言板，undefined 表示当前未展示留言区。
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}) {
  const [guestbookMessages, setGuestbookMessages] = useState<GuestbookMessage[]>([]);
  const [guestbookDraft, setGuestbookDraft] = useState<GuestbookInput>(defaultGuestbookDraft);
  const [guestbookCaptcha, setGuestbookCaptcha] = useState<GuestbookCaptcha | null>(null);
  const [guestbookReplyTarget, setGuestbookReplyTarget] = useState<GuestbookMessage | null>(null);
  const [guestbookEditingId, setGuestbookEditingId] = useState<number | null>(null);
  const [guestbookEditContent, setGuestbookEditContent] = useState("");
  const [guestbookLoading, setGuestbookLoading] = useState(false);
  const [guestbookSubmitting, setGuestbookSubmitting] = useState(false);
  const [guestbookCaptchaRefreshing, setGuestbookCaptchaRefreshing] = useState(false);
  const [guestbookAction, setGuestbookAction] = useState("");
  const [guestbookCooldown, setGuestbookCooldown] = useState(0);
  const guestbookSubmittingRef = useRef(false);
  const guestbookActionRef = useRef("");
  const guestbookCaptchaRefreshingRef = useRef(false);
  const messageScopeRef = useRef<string>("guestbook");
  const messageRequestIdRef = useRef(0);

  useEffect(() => {
    const updateCooldown = () => {
      setGuestbookCooldown(readGuestbookCooldown());
    };

    updateCooldown();
    const timer = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (articleId !== undefined) {
      void refreshGuestbook(articleId, articleId === null ? "" : currentArticlePassword(articleId));
    }
  }, [authenticated, articleId]);

  /** 重新加载留言板留言，并为当前访问者准备验证码状态。 */
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

  /** 在初次加载或提交失败后，为访客请求新的验证码。 */
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

  /** 通过共用表单发送留言板留言或顶层回复。 */
  async function submitGuestbookMessage(event: FormEvent<HTMLFormElement>, articleId: number | null = null) {
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

  /** 在管理员确认后删除一条留言板留言。 */
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

  /** 在管理员视图中切换留言的公开可见性，或将其标记为失效。 */
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

  /** 管理员编辑评论内容。 */
  async function editGuestbookMessage(id: number, content: string, articleId: number | null = null) {
    if (guestbookActionRef.current) return;
    const actionKey = `edit-${id}`;
    guestbookActionRef.current = actionKey;
    setGuestbookAction(actionKey);
    setError("");
    try {
      await updateMessage(id, content);
      setMessage("评论已更新");
      setGuestbookEditingId(null);
      setGuestbookEditContent("");
      await refreshGuestbook(articleId, articleId === null ? "" : currentArticlePassword(articleId));
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      guestbookActionRef.current = "";
      setGuestbookAction("");
    }
  }

  /** 只为当前文章附带路由中的访问密码。 */
  function currentArticlePassword(requestedArticleId: number) {
    if (articleId !== requestedArticleId) return "";
    return new URLSearchParams(window.location.search).get(passwordQueryKey) ?? "";
  }

  /** 退出回复模式时同时清除草稿的父留言标识。 */
  function cancelReply() {
    setGuestbookReplyTarget(null);
    setGuestbookDraft((currentDraft) => ({ ...currentDraft, parentId: null }));
  }

  /** 选中回复目标，并将当前留言表单滚动到可见位置。 */
  function replyToMessage(replyTarget: GuestbookMessage) {
    setGuestbookReplyTarget(replyTarget);
    setGuestbookDraft((currentDraft) => ({ ...currentDraft, parentId: replyTarget.id }));
    if (articleId == null) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      document.getElementById("article-comments")?.scrollIntoView({ behavior: "smooth" });
    }
  }

  /** 将管理员要编辑的留言内容填入编辑区。 */
  function startEditingMessage(id: number, content: string) {
    setGuestbookEditingId(id);
    setGuestbookEditContent(content);
  }

  /** 关闭留言编辑区并丢弃尚未保存的修改。 */
  function cancelEditingMessage() {
    setGuestbookEditingId(null);
    setGuestbookEditContent("");
  }

  /** 退出登录后清除留言表单中的管理员输入。 */
  function resetDraft() {
    setGuestbookDraft(defaultGuestbookDraft);
  }

  return {
    refresh: refreshGuestbook,
    resetDraft,
    props: {
      authenticated,
      captcha: guestbookCaptcha,
      cooldown: guestbookCooldown,
      draft: guestbookDraft,
      loading: guestbookLoading,
      messages: guestbookMessages,
      replyTarget: guestbookReplyTarget,
      submitting: guestbookSubmitting,
      captchaRefreshing: guestbookCaptchaRefreshing,
      action: guestbookAction,
      editingId: guestbookEditingId,
      editContent: guestbookEditContent,
      onCancelReply: cancelReply,
      onStatus: (id: number, status: "pending" | "approved", invalid: boolean) => void changeGuestbookStatus(id, status, invalid, articleId ?? null),
      onDelete: (id: number) => void removeGuestbookMessage(id, articleId ?? null),
      onEdit: (id: number, content: string) => void editGuestbookMessage(id, content, articleId ?? null),
      onDraftChange: setGuestbookDraft,
      onRefreshCaptcha: () => void refreshGuestbookCaptcha(),
      onReply: replyToMessage,
      onSubmit: (event: FormEvent<HTMLFormElement>) => void submitGuestbookMessage(event, articleId ?? null),
      onEditStart: startEditingMessage,
      onEditCancel: cancelEditingMessage,
      onEditContentChange: setGuestbookEditContent
    }
  };
}
