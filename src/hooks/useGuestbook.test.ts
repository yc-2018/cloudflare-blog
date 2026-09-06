// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuestbookMessage } from "../types";
import { useGuestbook } from "./useGuestbook";

const api = vi.hoisted(() => ({
  createMessage: vi.fn(),
  deleteMessage: vi.fn(),
  getMessageCaptcha: vi.fn(),
  listMessages: vi.fn(),
  updateMessage: vi.fn(),
  updateMessageStatus: vi.fn()
}));

vi.mock("../api", () => api);

/** 构建包含审核状态的留言，供作用域和本地待审核行为验证。 */
function message(id: number, status: "approved" | "pending" = "approved"): GuestbookMessage {
  return { id, parentId: null, nickname: "访客", content: `留言 ${id}`, status, createdAt: "2026-09-06 00:00:00", replies: [] };
}

/** 提供表单提交所需的最小事件对象。 */
function submitEvent() {
  return { preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>;
}

/** 手动控制网络响应的完成时机，复现切换页面或退出登录时的竞态。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/guestbook");
  api.listMessages.mockResolvedValue({ messages: [] });
  api.getMessageCaptcha.mockResolvedValue({ captcha: { question: "1 + 1 = ?", token: "captcha-token", expiresAt: Date.now() + 60000 } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("useGuestbook scope and submission", () => {
  it("ignores comments from a previous article after changing scope", async () => {
    let resolveOlder!: (value: { messages: GuestbookMessage[] }) => void;
    api.listMessages.mockReturnValueOnce(new Promise<{ messages: GuestbookMessage[] }>((resolve) => { resolveOlder = resolve; }));
    api.listMessages.mockResolvedValueOnce({ messages: [message(2)] });
    const onError = vi.fn();
    const onMessage = vi.fn();
    const { result, rerender } = renderHook(({ articleId }) => useGuestbook({ authenticated: true, articleId, onError, onMessage }), { initialProps: { articleId: 1 } });

    rerender({ articleId: 2 });
    await waitFor(() => expect(result.current.props.messages.map((item) => item.id)).toEqual([2]));
    await act(async () => resolveOlder({ messages: [message(1)] }));

    expect(result.current.props.messages.map((item) => item.id)).toEqual([2]);
    expect(result.current.props.loading).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the article password and reply target when submitting a comment", async () => {
    window.history.replaceState(null, "", "/articles/protected?password=AB12");
    api.createMessage.mockResolvedValue({ message: message(3) });
    const onError = vi.fn();
    const onMessage = vi.fn();
    const { result } = renderHook(() => useGuestbook({ authenticated: true, articleId: 1, onError, onMessage }));
    await waitFor(() => expect(result.current.props.loading).toBe(false));
    expect(api.listMessages).toHaveBeenCalledWith(1, "AB12");

    act(() => result.current.props.onDraftChange({ ...result.current.props.draft, nickname: "作者", content: "回复正文" }));
    act(() => result.current.props.onReply(message(2)));
    act(() => result.current.props.onSubmit(submitEvent()));

    await waitFor(() => expect(result.current.props.submitting).toBe(false));
    expect(api.createMessage).toHaveBeenCalledWith(expect.objectContaining({ articleId: 1, articlePassword: "AB12", parentId: 2, nickname: "作者", content: "回复正文" }));
    expect(result.current.props.replyTarget).toBeNull();
    expect(onMessage).toHaveBeenCalledWith("回复已发送");
    expect(onError).toHaveBeenCalledExactlyOnceWith("");
  });

  it("retains a visitor's pending message and enforces the send cooldown", async () => {
    const pendingMessage = message(4, "pending");
    api.createMessage.mockResolvedValue({ message: pendingMessage });
    api.listMessages.mockResolvedValueOnce({ messages: [] }).mockResolvedValueOnce({ messages: [pendingMessage] });
    const onError = vi.fn();
    const onMessage = vi.fn();
    const { result } = renderHook(() => useGuestbook({ authenticated: false, articleId: null, onError, onMessage }));
    await waitFor(() => expect(result.current.props.captcha?.token).toBe("captcha-token"));

    act(() => result.current.props.onDraftChange({ ...result.current.props.draft, nickname: "访客", email: "guest@example.com", content: "待审核留言", captchaAnswer: "2" }));
    act(() => result.current.props.onSubmit(submitEvent()));

    await waitFor(() => expect(result.current.props.messages[0]?.localPending).toBe(true));
    expect(api.listMessages).toHaveBeenLastCalledWith(null, "", [4]);
    expect(result.current.props.cooldown).toBeGreaterThan(0);
    expect(onMessage).toHaveBeenCalledWith("留言已提交，审核通过后会公开显示");

    act(() => result.current.props.onSubmit(submitEvent()));
    expect(api.createMessage).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("发送太频繁了"));
  });

  it.each([
    { articleId: 2, authenticated: true },
    { articleId: null, authenticated: true },
    { articleId: undefined, authenticated: true },
    { articleId: 1, authenticated: false }
  ])("clears editing and reply state when the comment context becomes $articleId / $authenticated", async (nextProps) => {
    const onError = vi.fn();
    const onMessage = vi.fn();
    const { result, rerender } = renderHook((props) => useGuestbook({ ...props, onError, onMessage }), {
      initialProps: { articleId: 1 as number | null | undefined, authenticated: true }
    });
    await waitFor(() => expect(result.current.props.loading).toBe(false));
    act(() => {
      result.current.props.onEditStart(1, "未保存的修改");
      result.current.props.onReply(message(1));
    });

    rerender(nextProps);

    expect(result.current.props.editingId).toBeNull();
    expect(result.current.props.editContent).toBe("");
    expect(result.current.props.replyTarget).toBeNull();
    expect(result.current.props.draft.parentId).toBeNull();
    await waitFor(() => expect(result.current.props.loading).toBe(false));
  });

  it.each([false, true])("ignores a pending list response after leaving the comment page (failure: %s)", async (fails) => {
    const pending = deferred<{ messages: GuestbookMessage[] }>();
    api.listMessages.mockReturnValueOnce(pending.promise);
    const onError = vi.fn();
    const onMessage = vi.fn();
    const { result, rerender } = renderHook(({ articleId }) => useGuestbook({ authenticated: true, articleId, onError, onMessage }), {
      initialProps: { articleId: 1 as number | undefined }
    });

    rerender({ articleId: undefined });
    await act(async () => {
      if (fails) pending.reject(new Error("旧页面加载失败"));
      else pending.resolve({ messages: [message(1)] });
    });

    expect(result.current.props.messages).toEqual([]);
    expect(result.current.props.loading).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["edit", "delete", "status"] as const)("does not reload the old article when its %s request finishes after navigation", async (operation) => {
    const pending = deferred<void>();
    api.updateMessage.mockReturnValue(pending.promise);
    api.deleteMessage.mockReturnValue(pending.promise);
    api.updateMessageStatus.mockReturnValue(pending.promise);
    api.listMessages.mockImplementation(async (articleId: number) => ({ messages: [message(articleId)] }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onError = vi.fn();
    const onMessage = vi.fn();
    const { result, rerender } = renderHook(({ articleId }) => useGuestbook({ authenticated: true, articleId, onError, onMessage }), { initialProps: { articleId: 1 } });
    await waitFor(() => expect(result.current.props.loading).toBe(false));
    act(() => {
      if (operation === "edit") result.current.props.onEdit(1, "修改后的旧评论");
      else if (operation === "delete") result.current.props.onDelete(1);
      else result.current.props.onStatus(1, "approved", false);
    });

    rerender({ articleId: 2 });
    await waitFor(() => expect(result.current.props.messages[0]?.id).toBe(2));
    await act(async () => pending.resolve());
    await waitFor(() => expect(result.current.props.action).toBe(""));

    expect(result.current.props.messages.map((item) => item.id)).toEqual([2]);
    expect(api.listMessages).toHaveBeenCalledTimes(2);
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith("");
  });

  it("preserves the new page's draft when a visitor submission on the previous page finishes", async () => {
    const pending = deferred<{ message: GuestbookMessage }>();
    api.createMessage.mockReturnValueOnce(pending.promise);
    const onError = vi.fn();
    const onMessage = vi.fn();
    const { result, rerender } = renderHook(({ articleId }) => useGuestbook({ authenticated: false, articleId, onError, onMessage }), { initialProps: { articleId: 1 } });
    await waitFor(() => expect(result.current.props.loading).toBe(false));
    act(() => result.current.props.onDraftChange({ ...result.current.props.draft, nickname: "访客", email: "guest@example.com", content: "旧文章评论", captchaAnswer: "2" }));
    act(() => result.current.props.onSubmit(submitEvent()));

    rerender({ articleId: 2 });
    await waitFor(() => expect(result.current.props.loading).toBe(false));
    act(() => result.current.props.onDraftChange({ ...result.current.props.draft, content: "新文章的草稿", captchaAnswer: "3" }));
    act(() => result.current.props.onReply(message(2)));
    await act(async () => pending.resolve({ message: message(3, "pending") }));
    await waitFor(() => expect(result.current.props.submitting).toBe(false));

    expect(result.current.props.draft.content).toBe("新文章的草稿");
    expect(result.current.props.draft.captchaAnswer).toBe("3");
    expect(result.current.props.replyTarget?.id).toBe(2);
    expect(api.listMessages).toHaveBeenCalledTimes(2);
    expect(JSON.parse(window.localStorage.getItem("guestbook:pending")!)).toEqual([{ scope: "article-1", message: message(3, "pending") }]);
    expect(result.current.props.cooldown).toBeGreaterThan(0);
    expect(onMessage).toHaveBeenCalledExactlyOnceWith("");
  });

  it("does not restore a visitor captcha after logging in", async () => {
    const pending = deferred<{ captcha: { question: string; token: string; expiresAt: number } }>();
    const onError = vi.fn();
    const onMessage = vi.fn();
    const { result, rerender } = renderHook(({ authenticated }) => useGuestbook({ authenticated, articleId: null, onError, onMessage }), { initialProps: { authenticated: false } });
    await waitFor(() => expect(result.current.props.loading).toBe(false));
    api.getMessageCaptcha.mockReturnValueOnce(pending.promise);
    act(() => result.current.props.onRefreshCaptcha());

    rerender({ authenticated: true });
    await waitFor(() => expect(result.current.props.loading).toBe(false));
    await act(async () => pending.resolve({ captcha: { question: "旧题目", token: "old-token", expiresAt: Date.now() + 60000 } }));

    expect(result.current.props.captcha).toBeNull();
    expect(result.current.props.draft.captchaToken).toBe("");
    expect(result.current.props.captchaRefreshing).toBe(false);
  });

  it("retains edited content after a failed save and allows retrying", async () => {
    api.updateMessage.mockRejectedValueOnce(new Error("保存失败")).mockResolvedValueOnce({ message: message(1) });
    const onError = vi.fn();
    const onMessage = vi.fn();
    const { result } = renderHook(() => useGuestbook({ authenticated: true, articleId: 1, onError, onMessage }));
    await waitFor(() => expect(result.current.props.loading).toBe(false));
    act(() => result.current.props.onEditStart(1, "待保存的修改"));
    act(() => result.current.props.onEdit(1, result.current.props.editContent));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("保存失败"));

    expect(result.current.props.editingId).toBe(1);
    expect(result.current.props.editContent).toBe("待保存的修改");
    expect(result.current.props.action).toBe("");

    act(() => result.current.props.onEdit(1, result.current.props.editContent));
    await waitFor(() => expect(result.current.props.editingId).toBeNull());
    expect(onMessage).toHaveBeenCalledWith("评论已更新");
    expect(api.updateMessage).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.props.action).toBe(""));
  });
});
