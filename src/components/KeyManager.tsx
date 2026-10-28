"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { createKeyAction, type KeyState } from "@/app/actions/keys";
import { CopyButton } from "./CopyButton";
import { SubmitButton } from "./SubmitButton";

const initialState: KeyState = {};

export function KeyManager() {
  const [state, formAction] = useActionState(createKeyAction, initialState);

  return (
    <div>
      {state.key ? (
        <div className="key-reveal">
          <div className="key-reveal-label">Key 仅显示一次，请现在复制保存。</div>
          <div className="key-row">
            <code className="key-value">{state.key}</code>
            <CopyButton value={state.key} />
          </div>
        </div>
      ) : null}

      <form action={formAction} className="form-stack">
        <div className="form-row">
          <div className="field">
            <label htmlFor="key-name">Key 名称</label>
            <input
              className="input"
              id="key-name"
              name="name"
              placeholder="例如：本地开发"
              maxLength={40}
              required
            />
          </div>
          <div className="field" style={{ alignSelf: "end" }}>
            <SubmitButton className="btn btn-dark btn-block" pendingText="创建中…">
              <KeyRound size={14} /> 创建 API Key
            </SubmitButton>
          </div>
        </div>
        {state.error ? (
          <div className="form-error" role="alert">
            {state.error}
          </div>
        ) : null}
      </form>
    </div>
  );
}
