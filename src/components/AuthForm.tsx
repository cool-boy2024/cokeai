"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, registerAction, type AuthState } from "@/app/actions/auth";
import { SubmitButton } from "./SubmitButton";

const initialState: AuthState = {};

export function AuthForm({
  mode,
  next,
  refCode,
}: {
  mode: "login" | "register";
  next?: string;
  refCode?: string;
}) {
  const action = mode === "login" ? loginAction : registerAction;
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="form-stack">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {refCode ? <input type="hidden" name="ref" value={refCode} /> : null}

      {mode === "register" ? (
        <div className="field">
          <label htmlFor="name">昵称</label>
          <input
            className="input"
            id="name"
            name="name"
            type="text"
            autoComplete="nickname"
            placeholder="你的昵称"
            minLength={2}
            maxLength={40}
            required
          />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="email">邮箱</label>
        <input
          className="input"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">密码</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder={mode === "login" ? "输入密码" : "至少 8 位"}
          minLength={mode === "login" ? 1 : 8}
          maxLength={72}
          required
        />
      </div>

      {state.error ? (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      ) : null}

      <SubmitButton pendingText={mode === "login" ? "正在登录…" : "正在创建…"}>
        {mode === "login" ? "登录" : "创建账户"}
      </SubmitButton>

      {mode === "register" ? (
        <p className="small muted" style={{ margin: 0, textAlign: "center" }}>
          注册即表示你同意 <Link className="text-link" href="/terms">服务条款</Link> 与{" "}
          <Link className="text-link" href="/privacy">隐私政策</Link>
        </p>
      ) : null}
    </form>
  );
}
