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

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/guestbook");
  api.listMessages.mockResolvedValue({ messages: [] });
  api.getMessageCaptcha.mockResolvedValue({ captcha: { question: "1 + 1 = ?", token: "captcha-token", expiresAt: Date.now() + 60000 } });
});

afterEach(() => {
  cleanup();
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
});
