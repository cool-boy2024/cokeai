"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { MASCOT_ART } from "./ShopMascotArt";

/**
 * 付款成功合体必杀技：全屏六幕（集合 → 合体 → 蓄力 → 动感光波 → 覆盖 → 祝贺卡）。
 * 动画全部走 CSS transform / opacity，JS 只负责开场、跳过和「每单只播一次」的标记。
 */

const SEEN_PREFIX = "cokeai.pv.seen.";
/** 与 ShopMascots 的 PAID_KEY 对齐：回到 /shop 时桌宠据此在 30s 内拍合影。 */
const PAID_AT_KEY = "cokeai:shop-paid-at";
const SKIP_DELAY_MS = 3000;
const CARD_AT_MS = 4900;
/** 只有 paid 触发自动播放；重看入口放宽到「已经付过款」的后续状态。 */
const AUTO_PLAY_STATUS = "paid";
const REWATCH_STATUSES = ["paid", "procuring", "delivered"];

/** A1 重写 ShopMascotArt 期间新旧 props 不同，统一按契约形状取一层。 */
const { claude: ClaudeArt, gpt: GptArt, grok: GrokArt } = MASCOT_ART;

type Stage = "idle" | "playing" | "done";

function readSeen(orderNo: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_PREFIX + orderNo) === "1";
  } catch {
    return false;
  }
}

function writeSeen(orderNo: string) {
  try {
    window.localStorage.setItem(SEEN_PREFIX + orderNo, "1");
  } catch {
    // 隐私模式下写不进去，动画退化成每次访问都播，不影响页面。
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 合体造型坐标取三位小数：服务端和浏览器的三角函数末位不同。 */
function round(value: number) {
  return Number(value.toFixed(3));
}

const FUSION_CENTER = { x: 110, y: 100 };

/** 12 道长短交替的星芒刺（星芒部分）。 */
const FUSION_RAYS = Array.from({ length: 12 }, (_, index) => {
  const angle = index * 30 - 90;
  const rad = (angle * Math.PI) / 180;
  const radius = index % 2 === 0 ? 74 : 64;
  return {
    angle,
    x1: round(FUSION_CENTER.x + Math.cos(rad) * 30),
    y1: round(FUSION_CENTER.y + Math.sin(rad) * 30),
    x2: round(FUSION_CENTER.x + Math.cos(rad) * radius),
    y2: round(FUSION_CENTER.y + Math.sin(rad) * radius),
  };
});

/** 六段外弦围成花结瓣（花结部分），和星芒一起组成双属性星花。 */
const FUSION_PETALS = Array.from({ length: 6 }, (_, index) => {
  const point = (step: number) => {
    const rad = ((step * 60 - 90) * Math.PI) / 180;
    return {
      x: round(FUSION_CENTER.x + Math.cos(rad) * 36),
      y: round(FUSION_CENTER.y + Math.sin(rad) * 36),
    };
  };
  const from = point(index);
  const to = point(index + 1);
  return { key: index, x1: from.x, y1: from.y, x2: to.x, y2: to.y };
});

/** 合体瞬间迸发的粒子：位置写死，避免每次渲染算随机数。 */
const FUSION_SPARKS = [
  { dx: -108, dy: -62, delay: 1000 },
  { dx: -64, dy: -104, delay: 1060 },
  { dx: 4, dy: -118, delay: 980 },
  { dx: 72, dy: -98, delay: 1080 },
  { dx: 112, dy: -46, delay: 1010 },
  { dx: 118, dy: 26, delay: 1090 },
  { dx: 74, dy: 88, delay: 1020 },
  { dx: 18, dy: 108, delay: 1100 },
  { dx: -46, dy: 96, delay: 990 },
  { dx: -102, dy: 52, delay: 1070 },
];

/** 光束上的电弧点。 */
const BEAM_ARCS = [
  { left: "16%", delay: 2480, up: true },
  { left: "38%", delay: 2620, up: false },
  { left: "57%", delay: 2760, up: true },
  { left: "78%", delay: 2540, up: false },
  { left: "92%", delay: 2860, up: true },
];

const PV_CSS = `
.pv-root {
  --pv-ink: #111312;
  --pv-paper: #fffdf7;
  --pv-green: #1f7a54;
  /* 云宝素材里的 <img> 是固定 96px（视觉云朵约 56×36），盒子和星芒取同一尺寸就是桌宠的原始比例。 */
  --pv-hero: 112px;
  --pv-fusion: clamp(196px, 33vmin, 320px);
  --pv-beam-h: clamp(30px, 5vmin, 64px);
  position: fixed;
  inset: 0;
  z-index: 260;
  overflow: hidden;
  pointer-events: none;
  font-family: var(--sans, "PingFang SC", "Noto Sans SC", sans-serif);
  -webkit-tap-highlight-color: transparent;
}
.pv-stage { position: absolute; inset: 0; }
.pv-veil {
  position: absolute;
  inset: 0;
  opacity: .42;
  background: radial-gradient(circle at 50% 48%, rgba(14, 20, 17, .58), rgba(7, 9, 8, .82));
  animation: pv-veil 4.4s linear both;
}
@keyframes pv-veil {
  0% { opacity: 0; }
  12% { opacity: .72; }
  82% { opacity: .74; }
  100% { opacity: .42; }
}
.pv-shake {
  position: absolute;
  inset: 0;
  animation: pv-shake 1.2s linear 2.4s both;
}
@keyframes pv-shake {
  0%, 100% { transform: translate3d(0, 0, 0); }
  8% { transform: translate3d(3px, -2px, 0); }
  18% { transform: translate3d(-3px, 2px, 0); }
  28% { transform: translate3d(2px, 2px, 0); }
  40% { transform: translate3d(-3px, -1px, 0); }
  52% { transform: translate3d(2px, 1px, 0); }
  66% { transform: translate3d(-2px, 2px, 0); }
  80% { transform: translate3d(1px, -1px, 0); }
}
.pv-art { display: block; width: 100%; height: 100%; }
.pv-hero {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--pv-hero);
  height: var(--pv-hero);
  margin-left: calc(var(--pv-hero) * -0.5);
  margin-top: calc(var(--pv-hero) * -0.5);
  will-change: transform, opacity;
}
.pv-hero-claude { animation: pv-summon-claude .8s cubic-bezier(.2, .9, .28, 1.02) both; }
.pv-hero-gpt { animation: pv-summon-gpt .8s cubic-bezier(.2, .9, .28, 1.02) both; }
@keyframes pv-summon-claude {
  0% { opacity: 0; transform: translate3d(-60vw, -44vh, 0) rotate(-200deg) scale(.42); }
  16% { opacity: 1; }
  68% { opacity: 1; transform: translate3d(-62%, -9%, 0) rotate(-11deg) scale(1.07); }
  87% { transform: translate3d(-57%, 3%, 0) rotate(-3deg) scale(.97); }
  100% { opacity: 1; transform: translate3d(-55%, 0, 0) rotate(-6deg) scale(1); }
}
@keyframes pv-summon-gpt {
  0% { opacity: 0; transform: translate3d(60vw, 44vh, 0) rotate(200deg) scale(.42); }
  16% { opacity: 1; }
  68% { opacity: 1; transform: translate3d(62%, 9%, 0) rotate(11deg) scale(1.07); }
  87% { transform: translate3d(57%, -3%, 0) rotate(3deg) scale(.97); }
  100% { opacity: 1; transform: translate3d(55%, 0, 0) rotate(6deg) scale(1); }
}
.pv-hero-body {
  display: block;
  width: 100%;
  height: 100%;
  animation: pv-absorb .34s cubic-bezier(.5, 0, .8, .35) .84s both;
}
.pv-hero-gpt .pv-hero-body { animation-name: pv-absorb-right; }
@keyframes pv-absorb {
  0% { opacity: 1; transform: scale(1) rotate(0deg); }
  65% { opacity: .92; transform: scale(.7) rotate(28deg); }
  100% { opacity: 0; transform: scale(.06) rotate(64deg); }
}
@keyframes pv-absorb-right {
  0% { opacity: 1; transform: scale(1) rotate(0deg); }
  65% { opacity: .92; transform: scale(.7) rotate(-28deg); }
  100% { opacity: 0; transform: scale(.06) rotate(-64deg); }
}
.pv-fusion {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--pv-fusion);
  height: var(--pv-fusion);
  margin-left: calc(var(--pv-fusion) * -0.5);
  margin-top: calc(var(--pv-fusion) * -0.5);
  opacity: 0;
  will-change: transform, opacity;
  animation: pv-fusion-life 2.9s cubic-bezier(.22, 1, .36, 1) .8s both;
}
@keyframes pv-fusion-life {
  0% { opacity: 0; transform: scale(.12) rotate(-70deg); }
  14% { opacity: 1; transform: scale(1.12) rotate(9deg); }
  24% { transform: scale(.97) rotate(-4deg); }
  33% { opacity: 1; transform: scale(1) rotate(0deg); }
  52% { transform: scale(1.06) rotate(0deg); }
  62% { transform: scale(1.02) rotate(0deg); }
  95% { opacity: 1; transform: scale(1.05) rotate(0deg); }
  100% { opacity: 0; transform: scale(.28) rotate(0deg); }
}
.pv-fusion-body {
  display: block;
  width: 100%;
  height: 100%;
  animation: pv-recoil 1.2s ease-out 2.4s both;
}
@keyframes pv-recoil {
  0% { transform: translate3d(0, 0, 0) rotate(0deg); }
  12% { transform: translate3d(-2%, 2%, 0) rotate(-4deg); }
  34% { transform: translate3d(-1%, 0, 0) rotate(-2deg); }
  100% { transform: translate3d(0, 0, 0) rotate(0deg); }
}
.pv-fusion-glow {
  position: absolute;
  inset: -20%;
  border-radius: 50%;
  opacity: 0;
  background: radial-gradient(circle, rgba(255, 222, 180, .9) 0%, rgba(255, 178, 122, .38) 42%, rgba(123, 235, 195, .18) 62%, transparent 74%);
  animation: pv-glow-charge 1.9s ease-in-out 1.72s both;
}
@keyframes pv-glow-charge {
  0% { opacity: .08; transform: scale(.86); }
  34% { opacity: .95; transform: scale(1.08); }
  62% { opacity: .78; transform: scale(1.02); }
  100% { opacity: .62; transform: scale(1.14); }
}
.pv-fusion-svg { display: block; width: 100%; height: 100%; position: relative; }
.pv-fusion-rays {
  transform-box: view-box;
  transform-origin: 110px 100px;
  animation: pv-ray-spin 9s linear infinite;
}
.pv-fusion-petals {
  transform-box: view-box;
  transform-origin: 110px 100px;
  animation: pv-ray-spin 13s linear infinite reverse;
}
@keyframes pv-ray-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.pv-arm {
  transform-box: view-box;
  animation-duration: 1.8s;
  animation-timing-function: cubic-bezier(.34, .9, .4, 1);
  animation-delay: 1.8s;
  animation-fill-mode: both;
}
.pv-arm-l { animation-name: pv-arm-left; transform-origin: 78px 140px; }
.pv-arm-r { animation-name: pv-arm-right; transform-origin: 142px 140px; }
@keyframes pv-arm-left {
  0% { transform: rotate(0deg); }
  25% { transform: rotate(104deg); }
  40% { transform: rotate(90deg); }
  100% { transform: rotate(90deg); }
}
@keyframes pv-arm-right {
  0% { transform: rotate(0deg); }
  25% { transform: rotate(-104deg); }
  40% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}
.pv-ring {
  position: absolute;
  inset: 6%;
  border-radius: 50%;
  border: 2px solid rgba(255, 214, 170, .92);
  opacity: 0;
  animation: pv-ring-out 1s ease-out 1.86s both;
}
.pv-ring-2 { border-color: rgba(123, 235, 195, .9); animation-delay: 2.46s; }
@keyframes pv-ring-out {
  0% { opacity: 0; transform: scale(.55); }
  18% { opacity: .9; }
  100% { opacity: 0; transform: scale(1.66); }
}
.pv-spark {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
  background: #ffe0ae;
  opacity: 0;
  box-shadow: 0 0 8px rgba(255, 224, 174, .9);
  animation: pv-spark-out .92s ease-out forwards;
}
@keyframes pv-spark-out {
  0% { opacity: 1; transform: translate3d(0, 0, 0) scale(.5); }
  100% { opacity: 0; transform: translate3d(var(--pv-dx, 0), var(--pv-dy, 0), 0) scale(.18); }
}
.pv-beam {
  position: absolute;
  /* 光波从合体造型右侧射出：水平偏移取云朵身体边缘（约 16% 宽），竖直按臂高 140/220 对齐。 */
  left: calc(50% + var(--pv-fusion) * 0.16);
  top: calc(50% + var(--pv-fusion) * 0.136 - var(--pv-beam-h) * 0.5);
  width: calc(56vw - var(--pv-fusion) * 0.16);
  height: var(--pv-beam-h);
  transform-origin: 0 50%;
  opacity: 0;
  will-change: transform, opacity;
  animation: pv-beam-fire 1.24s cubic-bezier(.16, .84, .3, 1) 2.4s both;
}
@keyframes pv-beam-fire {
  0% { opacity: 0; transform: scaleX(.02) scaleY(.55); }
  9% { opacity: 1; transform: scaleX(.1) scaleY(1.32); }
  26% { opacity: 1; transform: scaleX(1) scaleY(1); }
  92% { opacity: 1; transform: scaleX(1) scaleY(1); }
  100% { opacity: 0; transform: scaleX(1.04) scaleY(.82); }
}
.pv-beam-halo {
  position: absolute;
  inset: -180% -8%;
  border-radius: 999px;
  background: radial-gradient(ellipse at 32% 50%, rgba(255, 205, 150, .55), rgba(123, 235, 195, .2) 46%, transparent 72%);
}
.pv-beam-core {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: linear-gradient(90deg, #ffe8cc 0%, #ffb275 18%, #ffffff 40%, #ffd9a6 62%, #7bebc3 82%, #d8fff1 100%);
  box-shadow: 0 0 22px rgba(255, 178, 117, .6), 0 0 46px rgba(123, 235, 195, .38);
}
.pv-beam-spiral {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  overflow: hidden;
  mix-blend-mode: screen;
}
.pv-beam-spiral::before {
  content: "";
  position: absolute;
  inset: 0 -40px;
  background: repeating-linear-gradient(112deg, rgba(255, 255, 255, 0) 0 9px, rgba(255, 255, 255, .55) 9px 13px, rgba(255, 255, 255, 0) 13px 26px);
  animation: pv-spiral 420ms linear infinite;
}
.pv-beam-spiral-2::before {
  background: repeating-linear-gradient(68deg, rgba(255, 255, 255, 0) 0 8px, rgba(190, 255, 232, .5) 8px 12px, rgba(255, 255, 255, 0) 12px 24px);
  animation-duration: 560ms;
  animation-direction: reverse;
}
@keyframes pv-spiral {
  0% { transform: translate3d(-26px, 0, 0); }
  100% { transform: translate3d(26px, 0, 0); }
}
.pv-beam-arc {
  position: absolute;
  top: 50%;
  width: 7px;
  height: 22px;
  margin-top: -11px;
  border-radius: 999px;
  background: #ffffff;
  opacity: 0;
  box-shadow: 0 0 12px rgba(255, 255, 255, .9);
  animation: pv-arc-flicker .34s steps(2, end) infinite;
}
.pv-beam-arc-up { height: 15px; }
@keyframes pv-arc-flicker {
  0%, 100% { opacity: .1; transform: scaleY(.7); }
  50% { opacity: 1; transform: scaleY(1.25); }
}
.pv-muzzle {
  position: absolute;
  left: -8%;
  top: 50%;
  width: 26%;
  height: 240%;
  transform: translate3d(-50%, -50%, 0);
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #ffe3bd 34%, rgba(255, 196, 138, .5) 58%, transparent 74%);
  animation: pv-muzzle-pulse .4s ease-in-out infinite alternate;
}
@keyframes pv-muzzle-pulse {
  from { opacity: .8; transform: translate3d(-50%, -50%, 0) scale(.94); }
  to { opacity: 1; transform: translate3d(-50%, -50%, 0) scale(1.08); }
}
.pv-flash {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: radial-gradient(circle at 50% 48%, #ffffff 0%, #fff4dc 28%, #ffe8c2 46%, rgba(255, 232, 194, 0) 72%);
  animation: pv-flash .9s ease-out 3.5s both;
}
@keyframes pv-flash {
  0% { opacity: 0; transform: scale(.24); }
  24% { opacity: 1; transform: scale(1.18); }
  58% { opacity: .95; transform: scale(1.7); }
  100% { opacity: 0; transform: scale(2.35); }
}
.pv-grok {
  position: absolute;
  right: max(4vw, 18px);
  bottom: max(7vh, 26px);
  width: clamp(44px, 7vmin, 66px);
  height: clamp(44px, 7vmin, 66px);
  opacity: 0;
  animation: pv-grok-in .5s ease-out 2.3s both;
}
@keyframes pv-grok-in {
  0% { opacity: 0; transform: translate3d(0, 14px, 0) scale(.7); }
  100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
}
.pv-grok-star {
  position: absolute;
  top: 8%;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ffe6b8;
  opacity: 0;
  box-shadow: 0 0 8px rgba(255, 230, 184, .9);
  animation: pv-grok-star 1.5s ease-out infinite;
}
@keyframes pv-grok-star {
  0% { opacity: 0; transform: translate3d(0, 0, 0) scale(.6); }
  26% { opacity: 1; }
  100% { opacity: 0; transform: translate3d(-6px, -30px, 0) scale(1.05); }
}
.pv-card {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(92vw, 400px);
  padding: 26px 24px 18px;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, .7);
  background: var(--pv-paper);
  color: var(--pv-ink);
  text-align: center;
  /* 贺卡入场前不吃点击，播放期间页面照常可用。 */
  pointer-events: none;
  opacity: 0;
  transform: translate3d(-50%, -50%, 0);
  box-shadow: 0 26px 70px rgba(9, 12, 10, .38), 0 0 0 1px rgba(217, 119, 87, .12) inset;
  animation: pv-card-in .55s cubic-bezier(.22, 1, .36, 1) 4.35s both;
}
@keyframes pv-card-in {
  0% { opacity: 0; transform: translate3d(-50%, -45%, 0) scale(.9); }
  62% { opacity: 1; transform: translate3d(-50%, -50.7%, 0) scale(1.02); }
  100% { opacity: 1; transform: translate3d(-50%, -50%, 0) scale(1); }
}
.pv-card-kicker {
  margin: 0 0 6px;
  font-size: 11.5px;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--pv-green);
  font-weight: 600;
}
.pv-card-title {
  margin: 0 0 10px;
  font-size: clamp(24px, 5vw, 30px);
  line-height: 1.2;
  letter-spacing: -.01em;
  color: var(--pv-ink);
}
.pv-card-order {
  margin: 0 0 4px;
  font-size: 13px;
  color: rgba(17, 19, 18, .62);
}
.pv-card-order b {
  font-family: var(--mono, ui-monospace, Menlo, monospace);
  font-size: 13.5px;
  letter-spacing: .02em;
  color: var(--pv-ink);
  word-break: break-all;
}
.pv-card-sub {
  margin: 0 0 18px;
  font-size: 13.5px;
  color: rgba(17, 19, 18, .68);
}
.pv-card-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 13px 18px;
  border-radius: 12px;
  background: var(--pv-green);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition: transform 160ms cubic-bezier(.22, 1, .36, 1), background-color 200ms linear;
}
.pv-card-cta:hover { background: #1a6849; transform: translateY(-1px); }
.pv-card-cta:focus-visible { outline: 2px solid var(--pv-green); outline-offset: 3px; }
.pv-card-duo {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  margin-top: 14px;
  height: 64px;
}
.pv-card-duo span {
  display: block;
  width: 64px;
  height: 64px;
  transform-origin: 50% 90%;
  animation: pv-salute 1.9s cubic-bezier(.37, .03, .35, 1) infinite;
}
.pv-card-duo span + span { animation-delay: -1.1s; }
@keyframes pv-salute {
  0%, 100% { transform: translateY(0) rotate(0deg) scaleY(1); }
  38% { transform: translateY(-4px) rotate(-5deg) scaleY(1.03); }
  62% { transform: translateY(-3px) rotate(4deg) scaleY(1.01); }
  84% { transform: translateY(0) rotate(0deg) scaleY(.985); }
}
.pv-skip {
  position: absolute;
  top: max(14px, env(safe-area-inset-top));
  right: max(14px, env(safe-area-inset-right));
  padding: 8px 14px;
  border: 1px solid rgba(255, 255, 255, .34);
  border-radius: 999px;
  background: rgba(12, 16, 14, .46);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
  animation: pv-skip-in .3s ease-out both;
}
.pv-skip:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
@keyframes pv-skip-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.pv-replay {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 14px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--green, #1f7a54);
  font: inherit;
  font-size: 12.5px;
  letter-spacing: .01em;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: rgba(31, 122, 84, .32);
  text-underline-offset: 3px;
}
.pv-replay:hover { text-decoration-color: currentColor; }
.pv-done .pv-act { display: none; }
.pv-done .pv-veil { animation: none; opacity: .42; pointer-events: auto; }
.pv-done .pv-card { animation: none; opacity: 1; pointer-events: auto; transform: translate3d(-50%, -50%, 0) scale(1); }
.pv-done .pv-flash { animation: none; opacity: 0; }
@media (max-width: 767px) {
  .pv-root { --pv-hero: 88px; --pv-beam-h: clamp(22px, 4.4vmin, 40px); }
  .pv-shake { animation: none; }
  .pv-beam-spiral { display: none; }
  .pv-card { padding: 22px 18px 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .pv-shake,
  .pv-fusion-rays,
  .pv-fusion-petals,
  .pv-beam-arc,
  .pv-muzzle,
  .pv-grok-star,
  .pv-card-duo span { animation: none !important; }
  .pv-act { display: none; }
  .pv-veil { animation: none; opacity: .42; pointer-events: auto; }
  .pv-flash { animation: none; opacity: 0; }
  .pv-card { animation: none; opacity: 1; transform: translate3d(-50%, -50%, 0) scale(1); }
}
`;

/** 合体造型：星芒（claude）+ 云朵（gpt）+ 双臂，全部自绘。 */
function FusionForm() {
  return (
    <svg className="pv-fusion-svg" viewBox="0 0 220 220" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="pv-cloud-fill" cx="42%" cy="32%" r="74%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="70%" stopColor="#F3FBF7" />
          <stop offset="100%" stopColor="#DEF2E9" />
        </radialGradient>
      </defs>

      <g
        className="pv-fusion-rays"
        stroke="#D97757"
        strokeWidth="10"
        strokeLinecap="round"
        opacity="0.9"
      >
        {FUSION_RAYS.map((ray) => (
          <line key={ray.angle} x1={ray.x1} y1={ray.y1} x2={ray.x2} y2={ray.y2} />
        ))}
      </g>
      <g
        className="pv-fusion-petals"
        stroke="#10A37F"
        strokeWidth="8"
        strokeLinecap="round"
        opacity="0.42"
        fill="none"
      >
        {FUSION_PETALS.map((petal) => (
          <line key={petal.key} x1={petal.x1} y1={petal.y1} x2={petal.x2} y2={petal.y2} />
        ))}
      </g>

      <g className="pv-arm pv-arm-l">
        <line x1="78" y1="140" x2="34" y2="140" stroke="#E0865F" strokeWidth="12" strokeLinecap="round" />
      </g>
      <g className="pv-arm pv-arm-r">
        <line x1="142" y1="140" x2="186" y2="140" stroke="#E0865F" strokeWidth="12" strokeLinecap="round" />
      </g>

      <g fill="#D9EFE5">
        <circle cx="110" cy="136" r="35" />
        <circle cx="82" cy="148" r="24" />
        <circle cx="138" cy="148" r="24" />
        <circle cx="93" cy="114" r="27" />
        <circle cx="127" cy="114" r="27" />
      </g>
      <g fill="url(#pv-cloud-fill)">
        <circle cx="110" cy="136" r="33" />
        <circle cx="83" cy="148" r="22" />
        <circle cx="137" cy="148" r="22" />
        <circle cx="94" cy="115" r="25" />
        <circle cx="126" cy="115" r="25" />
      </g>

      <g>
        <ellipse cx="84" cy="141" rx="6.4" ry="3.6" fill="#FFAD8F" opacity="0.85" />
        <ellipse cx="136" cy="141" rx="6.4" ry="3.6" fill="#FFAD8F" opacity="0.85" />
        <ellipse cx="101" cy="128" rx="6.4" ry="8.6" fill="#5870E8" />
        <ellipse cx="121" cy="128" rx="6.4" ry="8.6" fill="#5870E8" />
        <circle cx="99" cy="125" r="2.3" fill="#FFFFFF" />
        <circle cx="119" cy="125" r="2.3" fill="#FFFFFF" />
        <path
          d="M105 144 Q110 148 115 144"
          stroke="#B85C3F"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  );
}

export function PaymentVictory({
  orderNo,
  status,
  orderHref,
}: {
  orderNo: string;
  /** 服务端订单状态；由 pending_payment 变 paid 时自动开场。 */
  status: string;
  orderHref?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [skipReady, setSkipReady] = useState(false);
  const startedRef = useRef(false);

  const href = orderHref || `/shop/orders/${orderNo}`;
  const start = useCallback(
    (instant: boolean) => {
      setSkipReady(false);
      if (instant) {
        setStage("done");
        writeSeen(orderNo);
        return;
      }
      // 真正开播才算「刚付款」：记下时间点并广播，桌宠回到 /shop 时才接得上合影窗口。
      try {
        window.sessionStorage.setItem(PAID_AT_KEY, String(Date.now()));
      } catch {
        // 隐私模式下写不进去，桌宠退回普通互动。
      }
      window.dispatchEvent(new CustomEvent("cokeai:order-paid"));
      setStage("playing");
    },
    [orderNo],
  );

  const close = useCallback(() => {
    setSkipReady(false);
    setStage("idle");
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 换订单（同一个组件实例复用）时把上一单的播放状态清干净。
  useEffect(() => {
    startedRef.current = false;
    setStage("idle");
  }, [orderNo]);

  // 播放期的时间轴：3s 放出跳过，4.9s 落到祝贺卡，并记下这一单已经播过。
  useEffect(() => {
    if (stage !== "playing") return;
    const skipTimer = window.setTimeout(() => setSkipReady(true), SKIP_DELAY_MS);
    const doneTimer = window.setTimeout(() => {
      setSkipReady(false);
      setStage("done");
      writeSeen(orderNo);
    }, CARD_AT_MS);
    return () => {
      window.clearTimeout(skipTimer);
      window.clearTimeout(doneTimer);
    };
  }, [stage, orderNo]);

  useEffect(() => {
    if (!mounted) return;
    const already = readSeen(orderNo);
    if (startedRef.current) return;
    const forced = new URLSearchParams(window.location.search).get("pv") === "1";
    if (!forced && (already || status !== AUTO_PLAY_STATUS)) return;
    startedRef.current = true;
    if (forced) {
      // 验收参数用完即弃，刷新不会再强制播第二次。
      const url = new URL(window.location.href);
      url.searchParams.delete("pv");
      window.history.replaceState(null, "", url.toString());
    }
    start(prefersReducedMotion());
  }, [mounted, orderNo, status, start]);

  useEffect(() => {
    if (stage === "idle") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, close]);

  const canReplay = mounted && REWATCH_STATUSES.includes(status);

  function replay() {
    startedRef.current = true;
    start(prefersReducedMotion());
  }

  function onCardCta(event: MouseEvent<HTMLAnchorElement>) {
    if (window.location.pathname !== href) return;
    // 已经在订单页：收起动画，把交付区滚进视野。
    event.preventDefault();
    close();
    const target = document.querySelector(".shop-order-grid");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <style>{PV_CSS}</style>

      {canReplay ? (
        <button type="button" className="pv-replay" onClick={replay}>
          ✨ 重看付款动画
        </button>
      ) : null}

      {stage === "idle" ? null : (
        <div className={`pv-root${stage === "done" ? " pv-done" : ""}`}>
          <div className="pv-veil" onClick={stage === "done" ? close : undefined} aria-hidden="true" />
          <div className="pv-stage" role="dialog" aria-labelledby="pv-card-title">
            <div className="pv-shake">
              <div className="pv-hero pv-hero-claude pv-act">
                <span className="pv-hero-body">
                  <ClaudeArt className="pv-art" eyes="happy" state="cheer" />
                </span>
              </div>
              <div className="pv-hero pv-hero-gpt pv-act">
                <span className="pv-hero-body">
                  <GptArt className="pv-art" eyes="happy" state="cheer" />
                </span>
              </div>

              <div className="pv-fusion pv-act">
                <div className="pv-fusion-glow" />
                <div className="pv-fusion-body">
                  <FusionForm />
                </div>
                <div className="pv-ring" />
                <div className="pv-ring pv-ring-2" />
                {FUSION_SPARKS.map((spark) => (
                  <span
                    key={`${spark.dx}-${spark.dy}`}
                    className="pv-spark"
                    style={
                      {
                        "--pv-dx": `${spark.dx}px`,
                        "--pv-dy": `${spark.dy}px`,
                        animationDelay: `${spark.delay}ms`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>

              <div className="pv-beam pv-act">
                <div className="pv-beam-halo" />
                <div className="pv-beam-core" />
                <div className="pv-beam-spiral" />
                <div className="pv-beam-spiral pv-beam-spiral-2" />
                {BEAM_ARCS.map((arc) => (
                  <span
                    key={arc.left}
                    className={`pv-beam-arc${arc.up ? " pv-beam-arc-up" : ""}`}
                    style={{ left: arc.left, animationDelay: `${arc.delay}ms` }}
                  />
                ))}
                <div className="pv-muzzle" />
              </div>

              <div className="pv-grok pv-act" aria-hidden="true">
                <GrokArt className="pv-art" eyes="wide" state="cheer" />
                <span className="pv-grok-star" style={{ left: "14%" }} />
                <span className="pv-grok-star" style={{ left: "52%", animationDelay: "420ms" }} />
                <span className="pv-grok-star" style={{ left: "82%", animationDelay: "900ms" }} />
              </div>
            </div>

            <div className="pv-flash pv-act" aria-hidden="true" />

            <div className="pv-card">
              <p className="pv-card-kicker">CokeAI 光线 · 双宠合体</p>
              <h2 className="pv-card-title" id="pv-card-title">
                🎉 恭喜拿下！
              </h2>
              <p className="pv-card-order">
                订单号 <b>{orderNo}</b>
              </p>
              <p className="pv-card-sub">光线已签收，货在路上。</p>
              <Link className="pv-card-cta" href={href} onClick={onCardCta}>
                货在路上 · 去订单页领取
              </Link>
              <div className="pv-card-duo" aria-hidden="true">
                <span>
                  <ClaudeArt className="pv-art" eyes="happy" state="cheer" />
                </span>
                <span>
                  <GptArt className="pv-art" eyes="happy" state="cheer" />
                </span>
              </div>
            </div>

            {stage === "playing" && skipReady ? (
              <button type="button" className="pv-skip" onClick={() => start(true)}>
                跳过 »
              </button>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
