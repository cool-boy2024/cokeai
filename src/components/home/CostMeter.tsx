"use client";

import { useState } from "react";

export type MeterModel = {
  id: string;
  name: string;
  inputCnyPerMtok: number;
  outputCnyPerMtok: number;
};

function yuan(value: number) {
  return `¥${value.toFixed(2)}`;
}

function tokenLabel(value: number) {
  return value.toLocaleString("zh-CN");
}

export function CostMeter({ models }: { models: MeterModel[] }) {
  const [index, setIndex] = useState(0);
  const [inputTokens, setInputTokens] = useState(200_000);
  const [outputTokens, setOutputTokens] = useState(50_000);

  if (models.length === 0) {
    return (
      <div className="meter" data-ui>
        <div className="meter-bar">
          <span>用量估算</span>
          <span>价格同步中</span>
        </div>
        <div className="meter-empty">
          <p>模型价格正在同步。价格发布后，这里会按 Token 单价直接算出一次调用的费用。</p>
        </div>
      </div>
    );
  }

  const model = models[Math.min(index, models.length - 1)];
  const cost =
    (inputTokens / 1_000_000) * model.inputCnyPerMtok +
    (outputTokens / 1_000_000) * model.outputCnyPerMtok;

  return (
    <div className="meter" data-ui>
      <div className="meter-bar">
        <span>用量估算</span>
        <div className="meter-models" role="group" aria-label="选择模型">
          {models.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={i === index ? "is-on" : undefined}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>

      <div className="meter-rows">
        <label className="meter-row">
          <span className="meter-key">输入</span>
          <input
            type="range"
            min={0}
            max={2_000_000}
            step={10_000}
            value={inputTokens}
            onChange={(event) => setInputTokens(Number(event.target.value))}
            aria-label="输入 Token 数"
          />
          <output className="meter-value">{tokenLabel(inputTokens)}</output>
        </label>
        <label className="meter-row">
          <span className="meter-key">输出</span>
          <input
            type="range"
            min={0}
            max={1_000_000}
            step={5_000}
            value={outputTokens}
            onChange={(event) => setOutputTokens(Number(event.target.value))}
            aria-label="输出 Token 数"
          />
          <output className="meter-value">{tokenLabel(outputTokens)}</output>
        </label>
      </div>

      <div className="meter-sum">
        <span>这次调用大约</span>
        <strong>{yuan(cost)}</strong>
      </div>

      <p className="meter-note">
        {model.name}：输入 {yuan(model.inputCnyPerMtok)} / 百万 Token，输出{" "}
        {yuan(model.outputCnyPerMtok)} / 百万 Token。实际以用量记录为准。
      </p>
    </div>
  );
}
