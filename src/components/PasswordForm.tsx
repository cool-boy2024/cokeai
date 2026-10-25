"use client";

import { useActionState } from "react";
import { updatePasswordAction, type PasswordState } from "@/app/actions/auth";
import { SubmitButton } from "./SubmitButton";

const initialState: PasswordState = {};

export function PasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, initialState);

  return (
    <form action={formAction} className="form-stack">
      <div className="field">
        <label htmlFor="current-password">当前密码</label>
        <input
          className="input"
          id="current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="new-password">新密码</label>
        <input
          className="input"
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
        />
        <span className="hint">至少 8 位。修改后其他设备会被强制退出。</span>
      </div>
      {state.error ? (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.success ? (
        <div className="form-success" role="status">
          {state.success}
        </div>
      ) : null}
      <SubmitButton className="btn btn-dark" pendingText="更新中…">
        更新密码
      </SubmitButton>
    </form>
  );
}
