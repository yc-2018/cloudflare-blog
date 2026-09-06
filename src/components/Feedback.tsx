import { X } from "lucide-react";

/** 显示按钮内的加载动画，避免重复朗读装饰元素。 */
export function ButtonSpinner() {
  return <span className="button-spinner" aria-hidden="true" />;
}

/** 显示可关闭的成功、提示或错误消息。 */
export function Status(props: { tone: "success" | "info" | "error"; text: string; onClose: () => void }) {
  return (
    <div className={`status ${props.tone}`}>
      <span>{props.text}</span>
      <button type="button" onClick={props.onClose} aria-label="关闭提示">
        <X size={16} />
      </button>
    </div>
  );
}

/** 显示列表为空或访问受限时的说明。 */
export function EmptyState(props: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <h2>{props.title}</h2>
      <p>{props.description}</p>
    </div>
  );
}
