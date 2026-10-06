// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuestbookInput, GuestbookMessage } from "../types";
import { Guestbook } from "./Guestbook";

const comment: GuestbookMessage = {
  id: 1,
  parentId: null,
  nickname: "作者",
  content: "第一行评论\n最后一行 🙂",
  status: "approved",
  createdAt: "2026-09-06 00:00:00",
  replies: [{
    id: 2,
    parentId: 1,
    nickname: "访客",
    content: "这是一条回复\n回复末尾",
    status: "approved",
    createdAt: "2026-09-06 00:01:00",
    replies: []
  }]
};

/** 提供真实的受控编辑状态，验证点击编辑和后续重渲染时的光标行为。 */
function EditableGuestbook({ action = "", authenticated = true }: { action?: string; authenticated?: boolean }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  return (
    <Guestbook
      mode="article"
      authenticated={authenticated}
      captcha={null}
      cooldown={0}
      draft={{ nickname: "作者", email: "", content: "" }}
      loading={false}
      messages={[comment]}
      replyTarget={null}
      submitting={false}
      captchaRefreshing={false}
      action={action}
      editingId={editingId}
      editContent={editContent}
      onCancelReply={vi.fn()}
      onStatus={vi.fn()}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
      onDraftChange={vi.fn()}
      onRefreshCaptcha={vi.fn()}
      onReply={vi.fn()}
      onSubmit={vi.fn()}
      onEditStart={(id, content) => { setEditingId(id); setEditContent(content); }}
      onEditCancel={() => setEditingId(null)}
      onEditContentChange={setEditContent}
    />
  );
}

/** 提供受控的评论草稿，验证工具栏按钮对正文与选区的改动。 */
function ComposableGuestbook({ initialContent = "" }: { initialContent?: string }) {
  const [draft, setDraft] = useState<GuestbookInput>({ nickname: "作者", email: "", content: initialContent });
  return (
    <Guestbook
      mode="article"
      authenticated
      captcha={null}
      cooldown={0}
      draft={draft}
      loading={false}
      messages={[]}
      replyTarget={null}
      submitting={false}
      captchaRefreshing={false}
      action=""
      editingId={null}
      editContent=""
      onCancelReply={vi.fn()}
      onStatus={vi.fn()}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
      onDraftChange={setDraft}
      onRefreshCaptcha={vi.fn()}
      onReply={vi.fn()}
      onSubmit={vi.fn()}
      onEditStart={vi.fn()}
      onEditCancel={vi.fn()}
      onEditContentChange={vi.fn()}
    />
  );
}

afterEach(cleanup);

describe("Guestbook comment editing", () => {
  it.each([0, 1])("places the caret at the end when editing comment index %i", (index) => {
    const view = render(<EditableGuestbook />);
    fireEvent.click(view.getAllByRole("button", { name: "编辑" })[index]);
    const editor = view.container.querySelector<HTMLTextAreaElement>(".message-edit-form textarea")!;

    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([editor.value.length, editor.value.length]);

    editor.setSelectionRange(2, 2);
    view.rerender(<EditableGuestbook />);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 2]);

    fireEvent.change(editor, { target: { value: "第一处修改后的内容", selectionStart: 3, selectionEnd: 3 } });
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 3]);
    editor.blur();
    editor.focus();
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 3]);
  });

  it.each([0, 1])("locks comment index %i while saving so later edits cannot be lost", (index) => {
    const view = render(<EditableGuestbook />);
    fireEvent.click(view.getAllByRole("button", { name: "编辑" })[index]);
    view.rerender(<EditableGuestbook action={`edit-${index + 1}`} />);

    expect(view.container.querySelector<HTMLTextAreaElement>(".message-edit-form textarea")!.disabled).toBe(true);
    expect((view.getByRole("button", { name: "保存中..." }) as HTMLButtonElement).disabled).toBe(true);
    const cancel = view.getByRole("button", { name: "取消" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.click(cancel);
    expect(view.container.querySelector(".message-edit-form")).not.toBeNull();
  });

  it("hides the editor as soon as administrator access is lost", () => {
    const view = render(<EditableGuestbook />);
    fireEvent.click(view.getAllByRole("button", { name: "编辑" })[0]);
    view.rerender(<EditableGuestbook authenticated={false} />);

    expect(view.container.querySelector(".message-edit-form")).toBeNull();
    expect(view.queryByRole("button", { name: "保存" })).toBeNull();
  });
});

describe("comment markdown toolbar", () => {
  /** 渲染评论输入区，并返回受控的正文文本域。 */
  function renderCompose(initialContent = "") {
    const view = render(<ComposableGuestbook initialContent={initialContent} />);
    return { view, textarea: view.container.querySelector<HTMLTextAreaElement>("#article-comment-content")! };
  }

  it("wraps the selected text and keeps the wrapped text selected", async () => {
    const { view, textarea } = renderCompose("早安世界");
    textarea.setSelectionRange(2, 4);

    fireEvent.click(view.getByRole("button", { name: "加粗" }));

    expect(textarea.value).toBe("早安**世界**");
    await waitFor(() => expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([4, 6]));
  });

  it.each([
    ["删除线", "~~删除线文字~~"],
    ["高亮文本", "==高亮文字=="],
    ["行内代码", "`代码`"],
    ["链接", "[链接文字](url)"]
  ])("inserts the %s placeholder when nothing is selected", (name, expected) => {
    const { view, textarea } = renderCompose();

    fireEvent.click(view.getByRole("button", { name }));

    expect(textarea.value).toBe(expected);
  });

  it("prefixes every non-empty selected line with a quote marker", () => {
    const { view, textarea } = renderCompose("第一行\n\n第三行");
    textarea.setSelectionRange(0, textarea.value.length);

    fireEvent.click(view.getByRole("button", { name: "引用" }));

    expect(textarea.value).toBe("> 第一行\n\n> 第三行");
  });

  it("inserts a quote placeholder when the caret sits on an empty line", () => {
    const { view, textarea } = renderCompose("已有内容\n");
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    fireEvent.click(view.getByRole("button", { name: "引用" }));

    expect(textarea.value).toBe("已有内容\n> 引用文字");
  });

  it("leaves the content untouched when wrapping would exceed the 500 character limit", () => {
    const { view, textarea } = renderCompose("字".repeat(500));
    textarea.setSelectionRange(0, 2);

    fireEvent.click(view.getByRole("button", { name: "加粗" }));

    expect(textarea.value).toBe("字".repeat(500));
  });
});
