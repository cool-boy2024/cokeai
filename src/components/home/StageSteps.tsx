"use client";

import { useState } from "react";

const STAGES = [
  {
    name: "注册",
    clause: "用邮箱注册，不需要信用卡。",
  },
  {
    name: "充值",
    clause: "USDT 确认后，额度自动到账。",
  },
  {
    name: "创建 Key",
    clause: "Key 只在创建时完整显示一次。",
  },
  {
    name: "调用",
    clause: "替换 Base URL，原有 SDK 直接能用。",
  },
];

function Fragment({ stage, modelId }: { stage: number; modelId: string }) {
  if (stage === 0) {
    return (
      <div className="frag" data-ui aria-hidden="true">
        <div className="frag-bar">
          <span>创建账号</span>
          <span>cokeai.cc.cd</span>
        </div>
        <div className="frag-body">
          <div className="frag-field">
            <span>邮箱</span>
            <em>you@example.com</em>
          </div>
          <div className="frag-field">
            <span>密码</span>
            <em>至少 8 位</em>
          </div>
          <div className="frag-button">创建账号</div>
          <p className="frag-note">注册后直接进入控制台，不需要绑卡。</p>
        </div>
      </div>
    );
  }

  if (stage === 1) {
    return (
      <div className="frag" data-ui aria-hidden="true">
        <div className="frag-bar">
          <span>充值余额</span>
          <span>USDT · TRC20</span>
        </div>
        <div className="frag-body">
          <div className="frag-line">
            <span>入账金额</span>
            <strong>¥39.00</strong>
          </div>
          <div className="frag-line">
            <span>到账额度</span>
            <strong>¥45.00</strong>
          </div>
          <div className="frag-line">
            <span>收款地址</span>
            <strong>TQ4…9f2k</strong>
          </div>
          <div className="frag-clock">
            <strong>09:42</strong>
            <span>转账后等待链上确认</span>
          </div>
          <p className="frag-note">地址 10 分钟内有效，确认后额度自动加上。</p>
        </div>
      </div>
    );
  }

  if (stage === 2) {
    return (
      <div className="frag" data-ui aria-hidden="true">
        <div className="frag-bar">
          <span>API Key</span>
          <span>1 个可用</span>
        </div>
        <div className="frag-body">
          <div className="frag-line">
            <span>名称</span>
            <strong>默认 Key</strong>
          </div>
          <div className="frag-key">sk-coke-••••••••••••3f9a</div>
          <div className="frag-line">
            <span>限额</span>
            <strong>不限</strong>
          </div>
          <p className="frag-note">只在创建时完整显示一次，之后可以随时撤销。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="frag" data-ui aria-hidden="true">
      <div className="frag-bar">
        <span>发起调用</span>
        <span>200 OK</span>
      </div>
      <div className="frag-body">
        <pre className="frag-code">
          <code>{`curl https://cokeai.cc.cd/v1/chat/completions \\
  -H "Authorization: Bearer $COKEAI_API_KEY" \\
  -d '{"model":"${modelId}","messages":[…]}'`}</code>
        </pre>
        <div className="frag-line">
          <span>输入</span>
          <strong>12 Token</strong>
        </div>
        <div className="frag-line">
          <span>输出</span>
          <strong>48 Token</strong>
        </div>
        <p className="frag-note">按本单实付扣费，用量和余额在控制台可查。</p>
      </div>
    </div>
  );
}

export function StageSteps({ modelId }: { modelId: string }) {
  const [stage, setStage] = useState(0);

  return (
    <div className="stages">
      <div className="stages-copy">
        <h2>接入流程</h2>
        <h3 className="stages-clause">{STAGES[stage].clause}</h3>
        <label className="stages-slider">
          <span className="sr-only">选择接入步骤</span>
          <input
            type="range"
            min={0}
            max={STAGES.length - 1}
            step={1}
            value={stage}
            onChange={(event) => setStage(Number(event.target.value))}
            aria-label="选择接入步骤"
          />
        </label>
        <div className="stages-names">
          {STAGES.map((item, index) => (
            <button
              key={item.name}
              type="button"
              className={index === stage ? "is-on" : undefined}
              aria-pressed={index === stage}
              onClick={() => setStage(index)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <p className="stages-foot">
          注册免费，充值后创建 Key 就能调用。余额不过期。
        </p>
      </div>

      <div className="stages-frag">
        <Fragment stage={stage} modelId={modelId} />
      </div>
    </div>
  );
}
