import { useRef, useState } from "react";
import React from "react";
import { Lock, X } from "lucide-react";
import { ButtonSpinner, Status } from "./Feedback";
import { asErrorMessage } from "../utils";

export interface PasswordPromptState {
  slug: string;
  value: string;
  error: string;
}

/** 收集四位文章访问密码并展示解锁错误。 */
export function ArticlePasswordDialog(props: {
  state: PasswordPromptState;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="login-dialog password-dialog" onSubmit={props.onSubmit}>
        <div className="dialog-header">
          <h2>输入访问密码</h2>
          <button className="icon-button subtle" type="button" onClick={props.onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <p className="dialog-description">这篇文章需要密码才能查看。</p>
        {props.state.error && <Status tone="error" text={props.state.error} onClose={() => undefined} />}
        <label>
          访问密码
          <input
            autoFocus
            required
            maxLength={4}
            minLength={4}
            pattern="[A-Za-z0-9]{4}"
            value={props.state.value}
            onChange={(event) => props.onChange(event.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 4))}
            autoComplete="off"
          />
        </label>
        <button className="text-button primary full" type="submit">
          <Lock size={16} />
          解锁文章
        </button>
      </form>
    </div>
  );
}

/** 提交管理员凭据，并在登录期间阻止重复提交。 */
export function LoginDialog(props: { onClose: () => void; onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  /** 提交登录表单，保留错误提示并防止连续重复请求。 */
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await props.onLogin(username, password);
    } catch (caught) {
      setError(asErrorMessage(caught));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="login-dialog" onSubmit={submit}>
        <div className="dialog-header">
          <h2>管理员登录</h2>
          <button className="icon-button subtle" type="button" onClick={props.onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        {error && <Status tone="error" text={error} onClose={() => setError("")} />}
        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button className="text-button primary full" type="submit" disabled={submitting}>
          {submitting && <ButtonSpinner />}
          {submitting ? "登录中..." : "登录"}
        </button>
      </form>
    </div>
  );
}
