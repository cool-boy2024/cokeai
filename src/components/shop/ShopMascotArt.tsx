"use client";

import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type ComponentType,
} from "react";

/**
 * 小店桌宠的造型层：只画角色，不含定位、气泡和交互。
 * 付款动画等后续组件直接 import 这里的角色本体；
 * 新的姿态（例如庆祝合体）也加在本文件里，避免造型散落各处。
 *
 * 三只角色：claude = 橙色像素蟹，gpt = 云宝素材，grok = 小黑球。
 * 视线跟随读外层写的 --m-eye-x / --m-eye-y，眨眼由外层 .is-blink 触发；
 * 动画样式全部写在本文件的 <style> 里，不依赖 public.css。
 */
export type ShopMascotKind = "claude" | "gpt" | "grok";

export type ShopMascotEyes = "open" | "happy" | "closed" | "wide" | "droop";

export type ShopMascotState =
  | "idle"
  | "think"
  | "cheer"
  | "sleep"
  | "alert"
  | "type"
  | "build"
  | "music"
  | "juggle";

export type ShopMascotArtProps = {
  /** 默认沿用桌宠的 .shop-mascot-art，换上下文时可覆盖。 */
  className?: string;
  /** 表情；claude 官方星芒没有脸，忽略。 */
  eyes?: ShopMascotEyes;
  /** 状态驱动辉光 / 转速 / 云宝素材切换。 */
  state?: ShopMascotState;
};

/** 造型画布尺寸：三个角色共用 96×96 的 viewBox。 */
export const MASCOT_VIEWBOX = "0 0 96 96";

const CLOUD_FADE_MS = 300;

/**
 * state → 云宝素材。juggling / dozing 系列是脚本驱动的导出文件，
 * <img> 里脚本不执行，静态帧只剩空白或纸飞机；cheer / sleep 因此改用
 * 能静态渲染的素材，脚本版文件仍随仓库一起放在 public/mascots/cloudling/。
 * type / build / music / juggle 同样只挑 <img> 下能静态出图的文件：
 * idle-reading（阅读/干活）、mini-happy（替代缺席的 building 与只剩纸飞机的
 * juggling）。仓库目前没有 cloudling-building.svg，所以 build 落到 mini-happy。
 */
const CLOUD_SRC: Record<ShopMascotState, string> = {
  idle: "/mascots/cloudling/cloudling-idle.svg",
  think: "/mascots/cloudling/cloudling-attention.svg",
  cheer: "/mascots/cloudling/cloudling-mini-happy.svg",
  sleep: "/mascots/cloudling/cloudling-mini-sleep.svg",
  alert: "/mascots/cloudling/cloudling-error.svg",
  type: "/mascots/cloudling/cloudling-idle-reading.svg",
  build: "/mascots/cloudling/cloudling-mini-happy.svg",
  music: "/mascots/cloudling/cloudling-idle.svg",
  juggle: "/mascots/cloudling/cloudling-mini-happy.svg",
};

/** 每个素材的 viewBox / 留白不同，放大倍数用来把云朵统一到约 50px 视觉宽度。 */
const CLOUD_ZOOM: Record<string, number> = {
  "/mascots/cloudling/cloudling-idle.svg": 2.6,
  "/mascots/cloudling/cloudling-attention.svg": 2.6,
  "/mascots/cloudling/cloudling-error.svg": 2.6,
  "/mascots/cloudling/cloudling-idle-reading.svg": 2.6,
  "/mascots/cloudling/cloudling-mini-happy.svg": 1.45,
  "/mascots/cloudling/cloudling-mini-sleep.svg": 1.45,
};

const CLOUD_CROSSFADE_CSS = `
.sma-gpt {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
}
.sma-gpt-img {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 96px;
  height: 96px;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  transform: translate(-50%, -50%) scale(var(--sma-cloud-zoom, 2.6));
}
.sma-gpt-img--enter { animation: sma-gpt-in ${CLOUD_FADE_MS}ms ease-out both; }
.sma-gpt-img--leave { animation: sma-gpt-out ${CLOUD_FADE_MS}ms ease-out both; }
@keyframes sma-gpt-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes sma-gpt-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .sma-gpt-img--enter,
  .sma-gpt-img--leave { animation-duration: 1ms; }
}
`;

const MASCOT_CSS = `
.sma-art { display: block; }
.sma-art [data-m-gaze] {
  transform: translate(var(--m-eye-x, 0px), var(--m-eye-y, 0px));
  transition: transform 180ms cubic-bezier(0.3, 0.9, 0.4, 1);
  will-change: transform;
}
.sma-art.sma-claude [data-m-gaze] {
  transform: translate(
    calc(var(--m-eye-x, 0px) * 0.32),
    calc(var(--m-eye-y, 0px) * 0.32)
  );
}
.sma-art [data-m-eyes] {
  transform-box: fill-box;
  transform-origin: 50% 55%;
  transition: transform 90ms ease-out;
}
.is-blink .sma-art [data-m-eyes] {
  transform: scaleY(0.08);
}

/* 像素蟹：蟹身、钳子、道具都是 rect 拼装，只允许直角或 1px 圆角。 */
.sma-crab-crab {
  transform-box: view-box;
  transform-origin: 48px 68px;
  transition: transform 220ms cubic-bezier(0.3, 0.9, 0.4, 1);
}
.sma-claude--idle .sma-crab-crab { animation: sma-crab-bob 3.8s ease-in-out infinite; }
.sma-claude--think .sma-crab-crab { animation: sma-crab-tilt 5.4s ease-in-out infinite; }
.sma-claude--type .sma-crab-crab { transform: translateY(2px) rotate(-4deg); }
.sma-claude--build .sma-crab-crab { animation: sma-crab-work 1.1s ease-in-out infinite; }
.sma-claude--music .sma-crab-crab { animation: sma-crab-sway 760ms ease-in-out infinite; }
.sma-claude--cheer .sma-crab-crab { animation: sma-crab-hop 1.1s cubic-bezier(0.3, 0.9, 0.4, 1) infinite; }
.sma-claude--sleep .sma-crab-crab { transform: translateY(5px) scaleY(0.86); }
.sma-claude--alert .sma-crab-crab { animation: sma-crab-jolt 620ms cubic-bezier(0.3, 0.9, 0.4, 1) infinite; }

/* 自动眨眼挂在外层，外层 .is-blink 的 scaleY 仍作用在 [data-m-eyes] 上，互不覆盖。 */
.sma-crab-autoblink {
  transform-box: fill-box;
  transform-origin: 50% 50%;
}
.sma-claude--idle .sma-crab-autoblink { animation: sma-crab-blink 6.4s linear infinite; }

.sma-crab-bubble {
  transform-box: fill-box;
  transform-origin: 50% 50%;
}
.sma-claude--think .sma-crab-bubble { animation: sma-crab-bubble 3.2s ease-in-out infinite; }
.sma-claude--type .sma-crab-claw--l { animation: sma-crab-tap 420ms ease-in-out infinite; }
.sma-claude--type .sma-crab-claw--r { animation: sma-crab-tap 420ms ease-in-out 210ms infinite; }
.sma-claude--cheer .sma-crab-star { animation: sma-crab-star 1.4s ease-out infinite; }

.sma-crab-hammer {
  transform-box: view-box;
  transform-origin: 78px 52px;
}
.sma-claude--build .sma-crab-hammer { animation: sma-crab-hammer 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite; }

.sma-crab-ball {
  transform-box: fill-box;
  transform-origin: 50% 100%;
}
.sma-claude--juggle .sma-crab-ball--a { animation: sma-crab-toss-a 1.25s ease-in-out infinite; }
.sma-claude--juggle .sma-crab-ball--b { animation: sma-crab-toss-b 1.25s ease-in-out 300ms infinite; }
.sma-claude--juggle .sma-crab-ball--c { animation: sma-crab-toss-c 1.25s ease-in-out 600ms infinite; }

@keyframes sma-crab-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2.2px); }
}
@keyframes sma-crab-blink {
  0%, 94%, 100% { transform: scaleY(1); }
  96% { transform: scaleY(0.12); }
}
@keyframes sma-crab-tilt {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-6deg); }
}
@keyframes sma-crab-work {
  0%, 100% { transform: translateY(0); }
  55% { transform: translateY(1.6px) scaleY(0.98); }
}
@keyframes sma-crab-sway {
  0%, 100% { transform: rotate(-4deg); }
  50% { transform: rotate(4deg); }
}
@keyframes sma-crab-hop {
  0%, 100% { transform: translateY(0) scaleY(1); }
  18% { transform: translateY(0) scaleY(0.92); }
  46% { transform: translateY(-7px) scaleY(1.04); }
  72% { transform: translateY(0) scaleY(0.96); }
}
@keyframes sma-crab-jolt {
  0%, 100% { transform: translateY(0) scaleY(1); }
  30% { transform: translateY(-5px) scaleY(1.05); }
  64% { transform: translateY(0) scaleY(0.95); }
}
@keyframes sma-crab-tap {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@keyframes sma-crab-bubble {
  0%, 100% { opacity: 0.85; transform: translateY(0) scale(0.96); }
  50% { opacity: 1; transform: translateY(-2px) scale(1); }
}
@keyframes sma-crab-hammer {
  0%, 12% { transform: rotate(0deg); }
  52% { transform: rotate(-32deg); }
  66% { transform: rotate(-2deg); }
  82%, 100% { transform: rotate(0deg); }
}
@keyframes sma-crab-star {
  0% { opacity: 0; transform: scale(0.4); }
  30% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: translateY(-7px) scale(0.85); }
}
@keyframes sma-crab-toss-a {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(4px, -9px); }
}
@keyframes sma-crab-toss-b {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(0, -12px); }
}
@keyframes sma-crab-toss-c {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-4px, -9px); }
}

/* 小黑球：待机轻微浮动，思考亮轨道，开心撒星，睡觉冒 Zzz。 */
.sma-grok-ball {
  transform-box: view-box;
  transform-origin: 48px 78px;
}
.sma-grok--idle .sma-grok-ball { animation: sma-grok-bob 4.6s ease-in-out infinite; }
.sma-grok--alert .sma-grok-ball {
  animation: sma-grok-jolt 620ms cubic-bezier(0.3, 0.9, 0.4, 1) 2;
}
.sma-grok-orbit {
  opacity: 0.12;
  transition: opacity 300ms ease;
}
.sma-grok--think .sma-grok-orbit { opacity: 0.95; }
.sma-grok--think .sma-grok-orbit-spin {
  animation: sma-grok-orbit-spin 4.5s linear infinite;
  transform-box: view-box;
  transform-origin: 48px 51px;
}
.sma-grok-spark {
  opacity: 0;
  transform-box: fill-box;
  transform-origin: 50% 50%;
}
.sma-grok--cheer .sma-grok-spark {
  animation: sma-grok-spark 1.8s cubic-bezier(0.2, 0.8, 0.3, 1) infinite;
}
.sma-grok-zzz { animation: sma-grok-zzz 3.2s ease-in-out infinite; }

/* type：面前一块像素键盘，眼球左右扫；build：球顶扳手敲两下；
   music：轨道环亮起 + 球下波形律动 + 球体左右摇；juggle：球顶抛三颗彩球。 */
.sma-grok-scan {
  transform-box: fill-box;
  transform-origin: 50% 50%;
}
.sma-grok--type .sma-grok-scan { animation: sma-grok-scan 1.4s steps(4, end) infinite; }
.sma-grok--type .sma-grok-key { animation: sma-grok-key 600ms steps(2, end) infinite; }

.sma-grok-wrench {
  transform-box: view-box;
  transform-origin: 48px 28px;
}
.sma-grok--build .sma-grok-wrench {
  animation: sma-grok-wrench 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.sma-grok--music .sma-grok-ball { animation: sma-grok-sway 900ms ease-in-out infinite; }
.sma-grok--music .sma-grok-orbit { opacity: 0.5; }
.sma-grok--music .sma-grok-wave {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: sma-grok-wave 900ms ease-in-out infinite;
}

.sma-grok-juggle {
  transform-box: fill-box;
  transform-origin: 50% 100%;
}
.sma-grok--juggle .sma-grok-juggle--a { animation: sma-grok-toss-a 1.2s ease-in-out infinite; }
.sma-grok--juggle .sma-grok-juggle--b { animation: sma-grok-toss-b 1.2s ease-in-out 300ms infinite; }
.sma-grok--juggle .sma-grok-juggle--c { animation: sma-grok-toss-c 1.2s ease-in-out 600ms infinite; }

@keyframes sma-grok-bob {
  0%, 100% { transform: translateY(0) scaleY(1); }
  45% { transform: translateY(-2.4px) scaleY(1.02); }
}
@keyframes sma-grok-jolt {
  0%, 100% { transform: translateY(0) scaleY(1); }
  28% { transform: translateY(-4.5px) scaleY(1.04); }
  62% { transform: translateY(0) scaleY(0.96); }
}
@keyframes sma-grok-orbit-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes sma-grok-spark {
  0% { opacity: 0; transform: translateY(3px) scale(0.4); }
  14% { opacity: 1; transform: translateY(-2px) scale(1.1); }
  46% { opacity: 0.9; transform: translateY(-6px) scale(1); }
  68%, 100% { opacity: 0; transform: translateY(-9px) scale(0.85); }
}
@keyframes sma-grok-zzz {
  0%, 100% { opacity: 0.35; transform: translateY(0); }
  50% { opacity: 0.9; transform: translateY(-2px); }
}
@keyframes sma-grok-scan {
  0%, 100% { transform: translateX(-4px); }
  50% { transform: translateX(4px); }
}
@keyframes sma-grok-key {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
@keyframes sma-grok-wrench {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  18% { transform: translateY(-2px) rotate(-24deg); }
  34% { transform: translateY(4px) rotate(6deg); }
  50% { transform: translateY(-2px) rotate(-24deg); }
  66% { transform: translateY(4px) rotate(6deg); }
  82% { transform: translateY(0) rotate(0deg); }
}
@keyframes sma-grok-sway {
  0%, 100% { transform: rotate(-4deg); }
  50% { transform: rotate(4deg); }
}
@keyframes sma-grok-wave {
  0%, 100% { transform: scaleY(0.55); opacity: 0.55; }
  50% { transform: scaleY(1); opacity: 1; }
}
@keyframes sma-grok-toss-a {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(5px, -10px); }
}
@keyframes sma-grok-toss-b {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(0, -13px); }
}
@keyframes sma-grok-toss-c {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-5px, -10px); }
}

@media (prefers-reduced-motion: reduce) {
  .sma-crab-crab,
  .sma-crab-autoblink,
  .sma-crab-bubble,
  .sma-crab-claw--l,
  .sma-crab-claw--r,
  .sma-crab-hammer,
  .sma-crab-star,
  .sma-crab-ball,
  .sma-grok-ball,
  .sma-grok-orbit-spin,
  .sma-grok-spark,
  .sma-grok-zzz,
  .sma-grok-scan,
  .sma-grok-key,
  .sma-grok-wrench,
  .sma-grok-wave,
  .sma-grok-juggle { animation: none; }
  .sma-art [data-m-gaze],
  .sma-art [data-m-eyes] { transition: none; }
  .sma-crab-crab { transition: none; }
}
`;

function MascotStyle() {
  return <style>{MASCOT_CSS}</style>;
}

const CRAB = {
  shell: "#E8825A",
  light: "#F2A57F",
  shade: "#C9633F",
  dark: "#2A1B16",
  hat: "#FFD166",
  hatShade: "#DFA733",
  phone: "#5AA9E6",
  phoneShade: "#3F7FBF",
  steel: "#C7CEDB",
  steelLight: "#E4E9F2",
  wood: "#8A5A3C",
  key: "#F3D9C7",
} as const;

/** 像素脸的五个眼态，全部用 rect 拼：happy 是像素 ⌒，closed 是横杠，droop 用同色眼皮压住上半截。 */
function ClaudeEyes({ eyes }: { eyes: ShopMascotEyes }) {
  if (eyes === "happy") {
    return (
      <g fill={CRAB.dark}>
        <rect x="35.2" y="50" width="2.6" height="2.6" />
        <rect x="37.8" y="47.6" width="2.6" height="2.6" />
        <rect x="40.4" y="47.6" width="2.6" height="2.6" />
        <rect x="43" y="50" width="2.6" height="2.6" />
        <rect x="50.4" y="50" width="2.6" height="2.6" />
        <rect x="53" y="47.6" width="2.6" height="2.6" />
        <rect x="55.6" y="47.6" width="2.6" height="2.6" />
        <rect x="58.2" y="50" width="2.6" height="2.6" />
      </g>
    );
  }
  if (eyes === "closed") {
    return (
      <g fill={CRAB.dark}>
        <rect x="37.6" y="49.4" width="6.6" height="2.6" />
        <rect x="52" y="49.4" width="6.6" height="2.6" />
      </g>
    );
  }
  if (eyes === "wide") {
    return (
      <g fill={CRAB.dark}>
        <rect x="37" y="45.6" width="6.4" height="7.2" />
        <rect x="52.6" y="45.6" width="6.4" height="7.2" />
      </g>
    );
  }
  if (eyes === "droop") {
    return (
      <g>
        <rect x="38" y="47.6" width="5.2" height="5.2" fill={CRAB.dark} />
        <rect x="52.8" y="47.6" width="5.2" height="5.2" fill={CRAB.dark} />
        {/* 眼皮用蟹身同色，只露出下缘形成下垂 */}
        <rect x="37.2" y="45.4" width="6.8" height="3.6" fill={CRAB.shell} />
        <rect x="52" y="45.4" width="6.8" height="3.6" fill={CRAB.shell} />
      </g>
    );
  }
  return (
    <g fill={CRAB.dark}>
      <rect x="38" y="47.4" width="5.2" height="5.2" />
      <rect x="52.8" y="47.4" width="5.2" height="5.2" />
    </g>
  );
}

function CrabStar({
  x,
  y,
  color,
  delay,
}: {
  x: number;
  y: number;
  color: string;
  delay: number;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="sma-crab-star" style={{ animationDelay: `${delay}ms` }} fill={color}>
        <rect x="-2" y="-7" width="4" height="14" />
        <rect x="-7" y="-2" width="14" height="4" />
      </g>
    </g>
  );
}

/** 像素 Z：7×10 的方块字，睡眠时用三档大小飘在头顶。 */
function CrabZ({ x, y, scale, opacity }: { x: number; y: number; scale: number; opacity: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill={CRAB.shade} opacity={opacity}>
      <rect x="0" y="0" width="7" height="2" />
      <rect x="4.6" y="2" width="2" height="2" />
      <rect x="3" y="4" width="2" height="2" />
      <rect x="1.4" y="6" width="2" height="2" />
      <rect x="0" y="8" width="7" height="2" />
    </g>
  );
}

/** 橙色像素蟹：蟹身、钳子、道具全部 rect 拼装；三球只在 juggle 时出现，平时没有腿也没有常驻球。 */
export function ClaudeMascotArt({
  className = "shop-mascot-art",
  eyes = "open",
  state = "idle",
}: ShopMascotArtProps = {}) {
  const eyeState: ShopMascotEyes = state === "sleep" ? "closed" : eyes;
  return (
    <>
      <MascotStyle />
      <svg
        className={`sma-art sma-claude sma-claude--${state} ${className}`.trim()}
        viewBox={MASCOT_VIEWBOX}
        aria-hidden="true"
        focusable="false"
        data-m-kind="claude"
        data-m-state={state}
      >
        {state === "think" ? (
          <g className="sma-crab-bubble">
            <rect
              x="53"
              y="35"
              width="4.5"
              height="4.5"
              fill="#FFF6EF"
              stroke={CRAB.shell}
              strokeWidth="1.4"
            />
            <rect
              x="58"
              y="30"
              width="5.5"
              height="5.5"
              fill="#FFF6EF"
              stroke={CRAB.shell}
              strokeWidth="1.4"
            />
            <rect
              x="60"
              y="5"
              width="28"
              height="22"
              rx="1.5"
              fill="#FFF6EF"
              stroke={CRAB.shell}
              strokeWidth="1.6"
            />
            <g fill={CRAB.dark}>
              <rect x="69" y="10" width="10" height="4" />
              <rect x="75" y="14" width="4" height="5" />
              <rect x="72" y="17" width="5" height="4" />
              <rect x="72" y="24" width="4" height="4" />
            </g>
          </g>
        ) : null}

        <g className="sma-crab-crab">
          {state === "build" ? (
            <g>
              <rect x="45" y="29" width="6" height="3" fill={CRAB.hatShade} />
              <rect x="33" y="31" width="30" height="6" rx="1" fill={CRAB.hat} />
              <rect x="33" y="34" width="30" height="2" fill={CRAB.hatShade} />
              <rect x="28" y="37" width="40" height="4" rx="1" fill={CRAB.hat} />
            </g>
          ) : null}

          {state === "music" ? (
            <g>
              <rect x="26" y="34" width="44" height="4" rx="1" fill={CRAB.phoneShade} />
              <rect x="26" y="36" width="4" height="5" fill={CRAB.phoneShade} />
              <rect x="66" y="36" width="4" height="5" fill={CRAB.phoneShade} />
              <rect x="22" y="39" width="8" height="10" rx="1.5" fill={CRAB.phone} />
              <rect x="66" y="39" width="8" height="10" rx="1.5" fill={CRAB.phone} />
            </g>
          ) : null}

          <g className="sma-crab-claw sma-crab-claw--l">
            <rect x="22" y="52" width="7" height="4" fill={CRAB.shade} />
            <rect x="11" y="45" width="11" height="5" fill={CRAB.shell} />
            <rect x="11" y="56" width="11" height="5" fill={CRAB.shell} />
            <rect x="18" y="48" width="8" height="11" fill={CRAB.shell} />
            <rect x="18" y="56" width="8" height="3" fill={CRAB.shade} />
          </g>

          <g className="sma-crab-claw sma-crab-claw--r">
            <rect x="67" y="52" width="7" height="4" fill={CRAB.shade} />
            <rect x="74" y="45" width="11" height="5" fill={CRAB.shell} />
            <rect x="74" y="56" width="11" height="5" fill={CRAB.shell} />
            <rect x="70" y="48" width="8" height="11" fill={CRAB.shell} />
            <rect x="70" y="56" width="8" height="3" fill={CRAB.shade} />
            {state === "build" ? (
              <g className="sma-crab-hammer">
                <rect x="76" y="32" width="4" height="20" fill={CRAB.wood} />
                <rect x="69" y="24" width="18" height="8" rx="1" fill={CRAB.steel} />
                <rect x="69" y="24" width="18" height="3" fill={CRAB.steelLight} />
              </g>
            ) : null}
          </g>

          <rect x="32" y="41" width="32" height="3" fill={CRAB.shell} />
          <rect x="28" y="44" width="40" height="16" fill={CRAB.shell} />
          <rect x="31" y="60" width="34" height="8" fill={CRAB.shell} />
          <rect x="32" y="45" width="11" height="3" fill={CRAB.light} />
          <rect x="31" y="64" width="34" height="4" fill={CRAB.shade} />

          <g data-m-gaze>
            <g className="sma-crab-autoblink">
              <g data-m-eyes>
                <ClaudeEyes eyes={eyeState} />
              </g>
            </g>
          </g>
          <rect x="45" y="57" width="6" height="2.5" rx="0.8" fill={CRAB.dark} />
        </g>

        {state === "type" ? (
          <g>
            <rect x="22" y="76" width="52" height="13" rx="1.5" fill={CRAB.dark} />
            {[79, 84].map((row) => (
              <g key={row}>
                {[0, 1, 2, 3, 4, 5].map((col) => (
                  <rect
                    key={col}
                    x={25 + col * 8}
                    y={row}
                    width="6"
                    height="3.5"
                    fill={CRAB.key}
                  />
                ))}
              </g>
            ))}
          </g>
        ) : null}

        {state === "juggle" ? (
          <g>
            <g className="sma-crab-ball sma-crab-ball--a">
              <rect x="26" y="18" width="7" height="7" rx="1" fill="#7CB342" />
            </g>
            <g className="sma-crab-ball sma-crab-ball--b">
              <rect x="40" y="16" width="7" height="7" rx="1" fill="#FFD166" />
            </g>
            <g className="sma-crab-ball sma-crab-ball--c">
              <rect x="54" y="18" width="7" height="7" rx="1" fill="#EF5350" />
            </g>
          </g>
        ) : null}

        {state === "cheer" ? (
          <g>
            <CrabStar x={18} y={30} color="#FFD166" delay={0} />
            <CrabStar x={77} y={26} color="#FFB74D" delay={260} />
            <CrabStar x={69} y={38} color="#FFD166" delay={520} />
          </g>
        ) : null}

        {state === "sleep" ? (
          <g>
            <CrabZ x={61} y={23} scale={1.6} opacity={0.95} />
            <CrabZ x={73} y={14} scale={1.1} opacity={0.75} />
            <CrabZ x={81} y={8} scale={0.8} opacity={0.55} />
          </g>
        ) : null}

        {state === "alert" ? (
          <g fill="#E8533F">
            <rect x="45.5" y="8" width="5" height="13" />
            <rect x="45.5" y="24" width="5" height="5" />
          </g>
        ) : null}
      </svg>
    </>
  );
}

const GROK_SPARKS = [
  { x: 21, y: 30, scale: 0.85, color: "#FFD166", delay: "0ms" },
  { x: 74, y: 26, scale: 1, color: "#8BE9FF", delay: "70ms" },
  { x: 82, y: 54, scale: 0.7, color: "#FF9FDB", delay: "140ms" },
  { x: 15, y: 57, scale: 0.75, color: "#FFD166", delay: "210ms" },
  { x: 62, y: 19, scale: 0.6, color: "#8BE9FF", delay: "270ms" },
] as const;

const SPARK_PATH = "M0 -4.4 L1.25 -1.25 L4.4 0 L1.25 1.25 L0 4.4 L-1.25 1.25 L-4.4 0 L-1.25 -1.25 Z";

function GrokEyes({ eyes, bodyId }: { eyes: ShopMascotEyes; bodyId: string }) {
  if (eyes === "happy") {
    return (
      <g fill="none" stroke="#F9FBFF" strokeWidth="2.6" strokeLinecap="round">
        <path d="M36.6 47.4 Q40.6 42.2 44.6 47.4" />
        <path d="M51.4 47.4 Q55.4 42.2 59.4 47.4" />
      </g>
    );
  }
  if (eyes === "closed") {
    return (
      <g stroke="#F9FBFF" strokeWidth="2.6" strokeLinecap="round">
        <path d="M37 47 H44.4" />
        <path d="M51.6 47 H59" />
      </g>
    );
  }
  if (eyes === "wide") {
    return (
      <g fill="#F9FBFF">
        <rect x="36.9" y="42" width="6.4" height="12.4" rx="3.2" />
        <rect x="50.7" y="42" width="6.4" height="12.4" rx="3.2" />
      </g>
    );
  }
  if (eyes === "droop") {
    return (
      <g>
        <rect x="37.4" y="45.2" width="5.6" height="8.8" rx="2.8" fill="#F9FBFF" />
        <rect x="51" y="45.2" width="5.6" height="8.8" rx="2.8" fill="#F9FBFF" />
        {/* 眼皮用球体同款渐变填，盖住眼睛上半截形成下垂感 */}
        <rect x="35.4" y="39.6" width="9.6" height="8.4" fill={`url(#${bodyId})`} />
        <rect x="49" y="39.6" width="9.6" height="8.4" fill={`url(#${bodyId})`} />
      </g>
    );
  }
  return (
    <g fill="#F9FBFF">
      <rect x="37.8" y="42.4" width="5.4" height="10.8" rx="2.7" />
      <rect x="51.4" y="42.4" width="5.4" height="10.8" rx="2.7" />
    </g>
  );
}

/** 小黑球：亮黑球体 + 高光弧 + 白色竖椭圆眼，eyes 五态全支持。 */
export function GrokMascotArt({
  className = "shop-mascot-art",
  eyes = "open",
  state = "idle",
}: ShopMascotArtProps = {}) {
  // 同 ClaudeMascotArt：渐变 id 逐实例唯一，避免多实例互相污染。
  const uid = useId().replace(/:/g, "");
  const bodyId = `sma-grok-body-${uid}`;
  const hiId = `sma-grok-hi-${uid}`;
  const eyeState: ShopMascotEyes = state === "sleep" ? "closed" : eyes;
  return (
    <>
      <MascotStyle />
      <svg
        className={`sma-art sma-grok sma-grok--${state} ${className}`.trim()}
        viewBox={MASCOT_VIEWBOX}
        aria-hidden="true"
        focusable="false"
        data-m-kind="grok"
        data-m-state={state}
      >
        <defs>
          <radialGradient
            id={bodyId}
            cx="36"
            cy="35"
            r="46"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#5C6274" />
            <stop offset="0.34" stopColor="#2B2F3A" />
            <stop offset="0.72" stopColor="#14161C" />
            <stop offset="1" stopColor="#06070A" />
          </radialGradient>
          <linearGradient id={hiId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="sma-grok-ball">
          <circle cx="48" cy="51" r="27" fill={`url(#${bodyId})`} />
          <circle cx="48" cy="51" r="26.4" fill="none" stroke="#7C8499" strokeOpacity="0.28" strokeWidth="1" />
          {/* 左上高光弧 + 一点镜面反光 */}
          <path
            d="M28.4 41.4 A25 25 0 0 1 42.8 25.8"
            fill="none"
            stroke={`url(#${hiId})`}
            strokeWidth="5.2"
            strokeLinecap="round"
          />
          <ellipse cx="34.4" cy="33" rx="3.8" ry="2.4" fill="#FFFFFF" opacity="0.18" transform="rotate(-32 34.4 33)" />
          <g data-m-gaze>
            <g className="sma-grok-scan">
              <g data-m-eyes>
                <GrokEyes eyes={eyeState} bodyId={bodyId} />
              </g>
            </g>
          </g>
        </g>
        {state === "build" ? (
          <g className="sma-grok-wrench">
            <rect x="45.5" y="16" width="5" height="18" fill="#AEB7C6" />
            <rect x="38" y="8" width="6" height="10" fill="#AEB7C6" />
            <rect x="38" y="8" width="20" height="5" fill="#AEB7C6" />
            <rect x="52" y="8" width="6" height="10" fill="#AEB7C6" />
            <rect x="38" y="8" width="20" height="2" fill={CRAB.steelLight} />
          </g>
        ) : null}
        {state === "type" ? (
          <g className="sma-grok-keyboard">
            <rect
              x="24"
              y="80"
              width="48"
              height="11"
              rx="1.5"
              fill="#2B2F3A"
              stroke="#7C8499"
              strokeOpacity="0.35"
            />
            {[82.5, 86.5].map((row, rowIndex) => (
              <g key={row}>
                {[0, 1, 2, 3, 4, 5].map((col) => (
                  <rect
                    key={col}
                    className="sma-grok-key"
                    x={27 + col * 7}
                    y={row}
                    width="5"
                    height="3"
                    fill="#8B93A8"
                    style={{ animationDelay: `${(rowIndex * 3 + col) * 60}ms` }}
                  />
                ))}
              </g>
            ))}
          </g>
        ) : null}
        {state === "music" ? (
          <path
            className="sma-grok-wave"
            d="M20 88 q4 -7 8 0 t8 0 t8 0 t8 0 t8 0 t8 0"
            fill="none"
            stroke="#8BE9FF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeOpacity="0.9"
          />
        ) : null}
        {state === "juggle" ? (
          <g>
            <circle className="sma-grok-juggle sma-grok-juggle--a" cx="38" cy="16" r="4" fill="#7CB342" />
            <circle className="sma-grok-juggle sma-grok-juggle--b" cx="48" cy="13" r="4" fill="#FFD166" />
            <circle className="sma-grok-juggle sma-grok-juggle--c" cx="58" cy="16" r="4" fill="#EF5350" />
          </g>
        ) : null}
        <g className="sma-grok-orbit" fill="none">
          <ellipse
            cx="48"
            cy="51"
            rx="41"
            ry="15.5"
            stroke="#8BE9FF"
            strokeOpacity="0.85"
            strokeWidth="1.1"
            strokeDasharray="4 6"
            strokeLinecap="round"
            transform="rotate(-16 48 51)"
          />
          <g className="sma-grok-orbit-spin">
            <circle cx="88" cy="51" r="2.2" fill="#C8F6FF" />
          </g>
        </g>
        {state === "cheer" ? (
          <g>
            {GROK_SPARKS.map((spark) => (
              <path
                key={`${spark.x}-${spark.y}`}
                className="sma-grok-spark"
                d={SPARK_PATH}
                fill={spark.color}
                transform={`translate(${spark.x} ${spark.y}) scale(${spark.scale})`}
                style={{ animationDelay: spark.delay }}
              />
            ))}
          </g>
        ) : null}
        {state === "sleep" ? (
          <g
            className="sma-grok-zzz"
            fill="#242832"
            fontFamily="ui-rounded, 'SF Pro Rounded', system-ui, sans-serif"
            fontWeight="700"
          >
            <text x="63" y="30" fontSize="13">
              Z
            </text>
            <text x="71.5" y="20.5" fontSize="9.5">
              z
            </text>
            <text x="77.5" y="13" fontSize="7">
              z
            </text>
          </g>
        ) : null}
      </svg>
    </>
  );
}

function useCloudCrossfade(src: string) {
  const [current, setCurrent] = useState(src);
  const [previous, setPrevious] = useState<string | null>(null);

  useEffect(() => {
    if (src === current) return;
    setPrevious(current);
    setCurrent(src);
  }, [src, current]);

  useEffect(() => {
    if (!previous) return;
    const timer = window.setTimeout(() => setPrevious(null), CLOUD_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [previous]);

  return { current, previous };
}

function cloudStyle(src: string): CSSProperties {
  return {
    "--sma-cloud-zoom": String(CLOUD_ZOOM[src] ?? 2.6),
  } as CSSProperties;
}

/** 云宝：直接用 Cloudling 素材（AGPL-3.0，见仓库根 NOTICE.md），state 换文件 + 300ms 交叉淡入。 */
export function GPTMascotArt({
  className = "shop-mascot-art",
  state = "idle",
}: ShopMascotArtProps = {}) {
  const { current, previous } = useCloudCrossfade(CLOUD_SRC[state]);
  return (
    <span
      className={`sma-art sma-gpt ${className}`.trim()}
      data-m-kind="gpt"
      data-m-state={state}
    >
      <style>{CLOUD_CROSSFADE_CSS}</style>
      {previous ? (
        <img
          key={previous}
          className="sma-gpt-img sma-gpt-img--leave"
          src={previous}
          alt=""
          loading="eager"
          draggable={false}
          aria-hidden="true"
          style={cloudStyle(previous)}
        />
      ) : null}
      <img
        key={current}
        className="sma-gpt-img sma-gpt-img--enter"
        src={current}
        alt=""
        loading="eager"
        draggable={false}
        aria-hidden="true"
        style={cloudStyle(current)}
      />
    </span>
  );
}

export const MASCOT_ART: Record<ShopMascotKind, ComponentType<ShopMascotArtProps>> = {
  claude: ClaudeMascotArt,
  gpt: GPTMascotArt,
  grok: GrokMascotArt,
};

/**
 * 待机姿态：hop 管跳跃位移、idle 管待机弹跳、mood 管表情彩蛋，
 * 三层分开挂动画，squash & stretch 才不会互相覆盖。
 */
export function ShopMascotIdlePose({
  kind,
  eyes,
  state,
}: {
  kind: ShopMascotKind;
  eyes?: ShopMascotEyes;
  state?: ShopMascotState;
}) {
  const Art = MASCOT_ART[kind];
  return (
    <span className="shop-mascot-hop">
      <span className="shop-mascot-idle">
        <span className="shop-mascot-mood">
          <Art eyes={eyes} state={state} />
        </span>
      </span>
    </span>
  );
}
