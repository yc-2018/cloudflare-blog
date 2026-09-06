// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuestbookMessage } from "../types";
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
