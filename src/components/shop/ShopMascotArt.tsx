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
 * 三只角色：claude = 官方星芒 logomark，gpt = 云宝素材，grok = 小黑球。
 * 视线跟随读外层写的 --m-eye-x / --m-eye-y，眨眼由外层 .is-blink 触发；
 * 动画样式全部写在本文件的 <style> 里，不依赖 public.css。
 */
export type ShopMascotKind = "claude" | "gpt" | "grok";

export type ShopMascotEyes = "open" | "happy" | "closed" | "wide" | "droop";

export type ShopMascotState = "idle" | "think" | "cheer" | "sleep" | "alert";

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

/** 坐标取三位小数：服务端和浏览器的 Math.sin 末位不同，不圆整会触发 hydration 不匹配。 */
function round(value: number) {
  return Number(value.toFixed(3));
}

/** 12 道圆头射线：长短交替 + 整体略歪，保持官方星芒的放射节奏。 */
export const STAR_RAYS = [
  { angle: -90, length: 31 },
  { angle: -60, length: 25 },
  { angle: -30, length: 30 },
  { angle: 0, length: 24 },
  { angle: 30, length: 30 },
  { angle: 60, length: 25 },
  { angle: 90, length: 31 },
  { angle: 120, length: 26 },
  { angle: 150, length: 29 },
  { angle: 180, length: 23 },
  { angle: 210, length: 30 },
  { angle: 240, length: 26 },
] as const;

const STAR_MARK = { x: 48, y: 48 };

function rayPoint(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return {
    x: round(STAR_MARK.x + Math.cos(rad) * radius),
    y: round(STAR_MARK.y + Math.sin(rad) * radius),
  };
}

const CLOUD_FADE_MS = 300;

/**
 * state → 云宝素材。juggling / dozing 系列是脚本驱动的导出文件，
 * <img> 里脚本不执行，静态帧只剩空白或纸飞机；cheer / sleep 因此改用
 * 能静态渲染的素材，脚本版文件仍随仓库一起放在 public/mascots/cloudling/。
 */
const CLOUD_SRC: Record<ShopMascotState, string> = {
  idle: "/mascots/cloudling/cloudling-idle.svg",
  think: "/mascots/cloudling/cloudling-attention.svg",
  cheer: "/mascots/cloudling/cloudling-mini-happy.svg",
  sleep: "/mascots/cloudling/cloudling-mini-sleep.svg",
  alert: "/mascots/cloudling/cloudling-error.svg",
};

/** 每个素材的 viewBox / 留白不同，放大倍数用来把云朵统一到约 50px 视觉宽度。 */
const CLOUD_ZOOM: Record<string, number> = {
  "/mascots/cloudling/cloudling-idle.svg": 2.6,
  "/mascots/cloudling/cloudling-attention.svg": 2.6,
  "/mascots/cloudling/cloudling-error.svg": 2.6,
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

/* 星芒：核心与芒体一起慢转，转速随状态变化。 */
.sma-claude-turn {
  transform-box: view-box;
  transform-origin: 48px 48px;
}
.sma-claude-halo {
  opacity: 0.32;
  transition: opacity 420ms ease;
}
.sma-claude--idle .sma-claude-turn { animation: sma-claude-turn 46s linear infinite; }
.sma-claude--idle .sma-claude-halo { animation: sma-claude-halo 4.8s ease-in-out infinite; }
.sma-claude--think .sma-claude-turn { animation: sma-claude-turn 16s linear infinite; }
.sma-claude--think .sma-claude-halo { opacity: 0.58; }
.sma-claude--cheer .sma-claude-turn { animation: sma-claude-turn 3.4s linear infinite; }
.sma-claude--cheer .sma-claude-halo { animation: sma-claude-halo-cheer 1.6s ease-in-out infinite; }
.sma-claude--sleep .sma-claude-turn { opacity: 0.66; }
.sma-claude--sleep .sma-claude-halo { opacity: 0.12; }
.sma-claude--alert .sma-claude-halo { animation: sma-claude-halo-alert 1.1s ease-in-out 2; }

@keyframes sma-claude-turn {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes sma-claude-halo {
  0%, 100% { opacity: 0.26; }
  50% { opacity: 0.44; }
}
@keyframes sma-claude-halo-cheer {
  0%, 100% { opacity: 0.5; }
  45% { opacity: 0.92; }
}
@keyframes sma-claude-halo-alert {
  0%, 100% { opacity: 0.3; }
  40% { opacity: 0.95; }
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

@media (prefers-reduced-motion: reduce) {
  .sma-claude-turn,
  .sma-claude-halo,
  .sma-grok-ball,
  .sma-grok-orbit-spin,
  .sma-grok-spark,
  .sma-grok-zzz { animation: none; }
  .sma-art [data-m-gaze],
  .sma-art [data-m-eyes] { transition: none; }
}
`;

function MascotStyle() {
  return <style>{MASCOT_CSS}</style>;
}

/** 官方星芒 logomark：12 瓣圆头芒体 + 中央圆核，无卡通脸；只用辉光和转速表达状态。 */
export function ClaudeMascotArt({
  className = "shop-mascot-art",
  state = "idle",
}: ShopMascotArtProps = {}) {
  // 同一页面会同时挂多份星芒（页脚桌宠/合体动画等）。渐变 id 必须逐实例唯一，
  // 否则 url(#id) 会解析到别的实例的 <defs>（该实例隐藏时填充整体失效）。
  const uid = useId().replace(/:/g, "");
  const rayId = `sma-claude-ray-${uid}`;
  const coreId = `sma-claude-core-${uid}`;
  const haloId = `sma-claude-halo-${uid}`;
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
        <defs>
          <linearGradient
            id={rayId}
            x1="24"
            y1="20"
            x2="74"
            y2="78"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#F2AC90" />
            <stop offset="0.52" stopColor="#D97757" />
            <stop offset="1" stopColor="#B9583A" />
          </linearGradient>
          <radialGradient id={coreId} cx="0.36" cy="0.3" r="0.82">
            <stop offset="0" stopColor="#FBD5BC" />
            <stop offset="0.5" stopColor="#E88F6C" />
            <stop offset="1" stopColor="#CE6A4A" />
          </radialGradient>
          <radialGradient id={haloId} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.42" stopColor="#D97757" stopOpacity="0.5" />
            <stop offset="1" stopColor="#D97757" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle
          className="sma-claude-halo"
          cx="48"
          cy="48"
          r="34"
          fill={`url(#${haloId})`}
        />
        <g data-m-gaze>
          <g className="sma-claude-turn">
            <g
              className="sma-claude-rays"
              fill="none"
              stroke={`url(#${rayId})`}
              strokeWidth="5.6"
              strokeLinecap="round"
            >
              {STAR_RAYS.map((ray) => {
                const inner = rayPoint(ray.angle, 5);
                const outer = rayPoint(ray.angle, ray.length * 1.15);
                return (
                  <line
                    key={ray.angle}
                    x1={inner.x}
                    y1={inner.y}
                    x2={outer.x}
                    y2={outer.y}
                  />
                );
              })}
            </g>
            <circle
              className="sma-claude-core"
              cx="48"
              cy="48"
              r="10.5"
              fill={`url(#${coreId})`}
            />
            <circle
              cx="48"
              cy="48"
              r="9.8"
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity="0.16"
              strokeWidth="1.1"
            />
          </g>
        </g>
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
            <g data-m-eyes>
              <GrokEyes eyes={eyeState} bodyId={bodyId} />
            </g>
          </g>
        </g>
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
