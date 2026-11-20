import type { ComponentType } from "react";

/**
 * 小店桌宠的造型层：只画角色，不含定位、气泡和交互。
 * 付款动画等后续组件直接 import 这里的角色本体；
 * 新的姿态（例如庆祝合体）也加在本文件里，避免造型散落各处。
 */
export type ShopMascotKind = "claude" | "gpt";

export type ShopMascotArtProps = {
  /** 默认沿用桌宠的 .shop-mascot-art，换上下文时可覆盖。 */
  className?: string;
};

/** 造型画布尺寸：两个角色共用 96×96 的 viewBox。 */
export const MASCOT_VIEWBOX = "0 0 96 96";

/** 坐标取三位小数：服务端和浏览器的 Math.sin 末位不同，不圆整会触发 hydration 不匹配。 */
function round(value: number) {
  return Number(value.toFixed(3));
}

/** 12 道圆头射线：长短交替 + 整体略歪，保持手绘星芒的手感。 */
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

const STAR_CENTER = { x: 48, y: 31 };

function polar(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return {
    x: round(STAR_CENTER.x + Math.cos(rad) * radius),
    y: round(STAR_CENTER.y + Math.sin(rad) * radius),
  };
}

/** 圆角星芒 + 大圆眼 + 卡通大框墨镜 + 小短脚：Q 版比例，头大身小。 */
export function ClaudeMascotArt({ className = "shop-mascot-art" }: ShopMascotArtProps = {}) {
  return (
    <svg className={className} viewBox={MASCOT_VIEWBOX} aria-hidden="true" focusable="false">
      {/* 小短脚和身子：头部占角色约三分之二 */}
      <g fill="#B85C3F">
        <rect x="35" y="74" width="10.5" height="9" rx="4.4" />
        <rect x="50.5" y="74" width="10.5" height="9" rx="4.4" />
      </g>
      <rect x="35" y="47" width="26" height="30" rx="13" fill="#CF6B4A" />
      {/* 星芒做圆角化：长短交替的圆头射线围着一个圆脸 */}
      <g
        transform="rotate(-5 48 31)"
        stroke="#D97757"
        strokeWidth="7.4"
        strokeLinecap="round"
      >
        {STAR_RAYS.map((ray) => {
          const inner = polar(ray.angle, 20);
          const outer = polar(ray.angle, ray.length);
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
      <circle cx="48" cy="31" r="22.5" fill="#D97757" />
      {/* 腮红 */}
      <ellipse cx="32" cy="43.5" rx="5.4" ry="3.2" fill="#F4718C" opacity="0.58" />
      <ellipse cx="64" cy="43.5" rx="5.4" ry="3.2" fill="#F4718C" opacity="0.58" />
      {/* 大圆眼：白色高光点让眼神发亮 */}
      <g className="shop-mascot-eye">
        <ellipse cx="35" cy="30.5" rx="6.2" ry="6.2" fill="#FFFDF8" />
        <circle cx="35.9" cy="31.4" r="3.5" fill="#231D1A" />
        <circle cx="33.7" cy="28.8" r="1.9" fill="#FFFFFF" />
        <circle cx="37.4" cy="33.6" r="0.95" fill="#FFFFFF" opacity="0.9" />
      </g>
      <g className="shop-mascot-eye">
        <ellipse cx="61" cy="30.5" rx="6.2" ry="6.2" fill="#FFFDF8" />
        <circle cx="61.9" cy="31.4" r="3.5" fill="#231D1A" />
        <circle cx="59.7" cy="28.8" r="1.9" fill="#FFFFFF" />
        <circle cx="63.4" cy="33.6" r="0.95" fill="#FFFFFF" opacity="0.9" />
      </g>
      {/* 卡通大框圆角墨镜：浅暖色镜片，眼睛仍清楚可见 */}
      <g fill="#FFD9C6" fillOpacity="0.3" stroke="#1D1B1A" strokeWidth="3.3">
        <rect x="22.5" y="22" width="24.5" height="17.5" rx="7.8" />
        <rect x="49" y="22" width="24.5" height="17.5" rx="7.8" />
      </g>
      <path
        d="M47 29.5 L49 29.5"
        stroke="#1D1B1A"
        strokeWidth="3.3"
        strokeLinecap="round"
      />
      <path
        d="M22.9 27.2 L13.2 23.2 M73.1 27.2 L82.8 23.2"
        stroke="#1D1B1A"
        strokeWidth="3.1"
        strokeLinecap="round"
      />
      {/* 小嘴：墨镜下方一点点 */}
      <path
        d="M44.9 45.8 Q48 48.6 51.1 45.8"
        stroke="#B85C3F"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** OpenAI 花结：六段圆头短线拧成风车，中心留出六边形空心放脸。 */
export const KNOT = { cx: 48, cy: 32, distance: 21.2, length: 27, thickness: 10.2, twist: 3.4 };

export const KNOT_ARMS = [0, 60, 120, 180, 240, 300].map((offset) => {
  const angle = offset - 90;
  const rad = (angle * Math.PI) / 180;
  const tangent = { x: -Math.sin(rad), y: Math.cos(rad) };
  const center = {
    x: KNOT.cx + Math.cos(rad) * KNOT.distance + tangent.x * KNOT.twist,
    y: KNOT.cy + Math.sin(rad) * KNOT.distance + tangent.y * KNOT.twist,
  };
  const half = KNOT.length / 2;
  return {
    x1: round(center.x - tangent.x * half),
    y1: round(center.y - tangent.y * half),
    x2: round(center.x + tangent.x * half),
    y2: round(center.y + tangent.y * half),
  };
});

/** 绿色花结 + 直接在花结中心点上的大圆眼 + 腮红 + 小短脚，不带任何文字标签。 */
export function GPTMascotArt({ className = "shop-mascot-art" }: ShopMascotArtProps = {}) {
  return (
    <svg className={className} viewBox={MASCOT_VIEWBOX} aria-hidden="true" focusable="false">
      <g fill="#0C7D62">
        <rect x="36.5" y="72" width="10" height="8.5" rx="4.2" />
        <rect x="49.5" y="72" width="10" height="8.5" rx="4.2" />
      </g>
      <rect x="37.5" y="51" width="21" height="24" rx="10.5" fill="#0C7D62" />
      <g
        transform="rotate(-6 48 32)"
        stroke="#10A37F"
        strokeWidth={KNOT.thickness}
        strokeLinecap="round"
      >
        {KNOT_ARMS.map((arm, index) => (
          <line key={index} x1={arm.x1} y1={arm.y1} x2={arm.x2} y2={arm.y2} />
        ))}
      </g>
      {/* 腮红 */}
      <ellipse cx="31" cy="42" rx="5.8" ry="3.5" fill="#FFAD8F" opacity="0.95" />
      <ellipse cx="65" cy="42" rx="5.8" ry="3.5" fill="#FFAD8F" opacity="0.95" />
      {/* 眼睛直接点在花结中心 */}
      <g className="shop-mascot-eye">
        <ellipse cx="40.9" cy="31.5" rx="5.8" ry="5.8" fill="#FFFDF8" />
        <circle cx="41.6" cy="32.3" r="3.3" fill="#0B2B22" />
        <circle cx="39.8" cy="30" r="1.7" fill="#FFFFFF" />
        <circle cx="42.9" cy="34" r="0.85" fill="#FFFFFF" opacity="0.9" />
      </g>
      <g className="shop-mascot-eye">
        <ellipse cx="55.1" cy="31.5" rx="5.8" ry="5.8" fill="#FFFDF8" />
        <circle cx="55.8" cy="32.3" r="3.3" fill="#0B2B22" />
        <circle cx="54" cy="30" r="1.7" fill="#FFFFFF" />
        <circle cx="57.1" cy="34" r="0.85" fill="#FFFFFF" opacity="0.9" />
      </g>
      {/* 小嘴 */}
      <path
        d="M45.6 42.8 Q48 45.6 50.4 42.8"
        stroke="#083527"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export const MASCOT_ART: Record<ShopMascotKind, ComponentType<ShopMascotArtProps>> = {
  claude: ClaudeMascotArt,
  gpt: GPTMascotArt,
};

/**
 * 待机姿态：hop 管跳跃位移、idle 管待机弹跳、mood 管表情彩蛋，
 * 三层分开挂动画，squash & stretch 才不会互相覆盖。
 */
export function ShopMascotIdlePose({ kind }: { kind: ShopMascotKind }) {
  const Art = MASCOT_ART[kind];
  return (
    <span className="shop-mascot-hop">
      <span className="shop-mascot-idle">
        <span className="shop-mascot-mood">
          <Art />
        </span>
      </span>
    </span>
  );
}
