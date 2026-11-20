/**
 * 桌宠移动引擎：所有位移只有两种走法——近距离 hop 链、远距离飘移。
 *
 * 三层 transform 合成（由 ShopMascots 渲染）：
 *   外层 .shop-mascot        —— translate3d 定住目标点，X 走线性
 *   中层 .shop-mascot-lift   —— Y 抛物线 / 飘移悬浮
 *   内层 .shop-mascot-stance —— squash & stretch、倾斜
 *
 * 不碰 left/top，也不会瞬移；reduced-motion 下直接落位，不播动画。
 */

export type MascotPoint = { x: number; y: number };

export type MascotLayers = {
  /** 外层：translate3d 定住目标点。 */
  root: HTMLElement;
  /** 中层：抛物线 / 飘移悬浮。 */
  lift: HTMLElement;
  /** 内层：squash & stretch、倾斜。 */
  stance: HTMLElement;
};

export type TravelerOptions = {
  layers: MascotLayers;
  /** 角色边长，用来定弧高和粒子落点。 */
  size: () => number;
  /** 星光 / 尾迹粒子层；移动端与 reduced-motion 下返回 null。 */
  fx: () => HTMLElement | null;
  /** 减少动态效果：直接落位，不播动画。 */
  reduced: () => boolean;
};

export type TravelRequest = {
  to: MascotPoint;
  /** 强制飘移（跨栏、绕场）；不传按距离自动选。 */
  drift?: boolean;
  /** 最后一跳落地时触发，互动编排靠它串动作。 */
  onLand?: (at: MascotPoint) => void;
  /** 整段位移结束时触发。 */
  onDone?: (at: MascotPoint) => void;
};

export type Traveler = {
  readonly at: MascotPoint;
  readonly busy: boolean;
  /** 直接落位：首帧、resize、reduced-motion 用。 */
  snap(to: MascotPoint): void;
  /** 走向目标点；正在移动时只保留最新一个请求。 */
  goTo(request: TravelRequest): void;
  /** 朝移动方向倾斜：-1 左 / 1 右 / 0 回正。 */
  face(direction: -1 | 0 | 1): void;
  /** 原地开心蹦一下，不产生位移。 */
  bounce(): void;
  cancel(): void;
};

/** 超过这个距离改走飘移。 */
export const HOP_MAX_DISTANCE = 320;

const HOP_PREP_MS = 120;
const HOP_AIR_MIN_MS = 250;
const HOP_AIR_MAX_MS = 310;
const HOP_GAP_MIN_MS = 160;
const HOP_GAP_MAX_MS = 220;
const LAND_MS = 100;
const DRIFT_MS = 860;
const DRIFT_RISE = 26;

function random(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function setVar(node: HTMLElement, name: string, value: string) {
  node.style.setProperty(name, value);
}

export function createTraveler(options: TravelerOptions): Traveler {
  const { layers } = options;
  let at: MascotPoint = { x: 0, y: 0 };
  let queued: TravelRequest | null = null;
  let running = false;
  let cancelled = false;
  const timers = new Set<number>();

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!cancelled) fn();
    }, ms);
    timers.add(id);
  };

  const clearTimers = () => {
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };

  /** 外层只管目标点，时长和缓动由 hop / 飘移各自指定。 */
  const setRoot = (point: MascotPoint, ms: number, ease: string) => {
    setVar(layers.root, "--move-ms", `${Math.round(ms)}ms`);
    setVar(layers.root, "--move-ease", ease);
    layers.root.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0)`;
  };

  const setLean = (deg: number) => {
    setVar(layers.stance, "--m-lean", `${deg.toFixed(1)}deg`);
  };

  const face = (direction: -1 | 0 | 1) => {
    setLean(direction === 0 ? 0 : direction * 6);
  };

  const land = (point: MascotPoint) => {
    layers.stance.classList.add("is-land");
    later(() => layers.stance.classList.remove("is-land"), LAND_MS + 20);
    const size = options.size();
    spawnSparks(options.fx(), point.x + size / 2, point.y + size - 6, Math.random() < 0.5 ? 1 : 2);
  };

  const finish = (request: TravelRequest, point: MascotPoint) => {
    running = false;
    face(0);
    request.onLand?.(point);
    request.onDone?.(point);
    const next = queued;
    queued = null;
    if (next) start(next);
  };

  /** 每跳抛物线：外层 X 线性逼近，中层 Y 走 0-50-100% 的弧，内层撑开。 */
  const stepHop = (
    request: TravelRequest,
    from: MascotPoint,
    hops: number,
    arc: number,
    lean: number,
    index: number,
  ) => {
    if (cancelled || !running) return;
    const to = request.to;
    const progress = index / hops;
    const point = {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
    const duration = random(HOP_AIR_MIN_MS, HOP_AIR_MAX_MS);
    // 后面的跳幅度收一点，连跳才像在收力落地。
    const height = arc * (1 - (index - 1) * 0.12);
    setRoot(point, duration, "linear");
    setVar(layers.lift, "--hop-ms", `${Math.round(duration)}ms`);
    setVar(layers.lift, "--hop-arc", `${Math.round(height)}px`);
    setLean(lean);
    layers.lift.classList.add("is-hop");
    layers.stance.classList.add("is-air");
    at = point;

    later(() => {
      layers.lift.classList.remove("is-hop");
      layers.stance.classList.remove("is-air");
      land(point);
      if (index === hops) {
        finish(request, point);
        return;
      }
      later(() => stepHop(request, from, hops, arc, lean, index + 1), random(HOP_GAP_MIN_MS, HOP_GAP_MAX_MS));
    }, duration);
  };

  const hop = (request: TravelRequest, from: MascotPoint) => {
    const distance = Math.hypot(request.to.x - from.x, request.to.y - from.y);
    // 90px 一跳：近的 2 连跳，接近 320px 时 4 连跳。
    const hops = clamp(Math.round(distance / 90), 2, 4);
    const direction = Math.sign(request.to.x - from.x) || 1;
    const arc = clamp(24 + distance * 0.16, 28, 64);
    const lean = direction * random(4, 8);

    // 预备下蹲 120ms：先压扁再起跳，重心才有准备。
    layers.stance.classList.add("is-crouch");
    later(() => {
      layers.stance.classList.remove("is-crouch");
      stepHop(request, from, hops, arc, lean, 1);
    }, HOP_PREP_MS);
  };

  const drift = (request: TravelRequest, from: MascotPoint) => {
    const to = request.to;
    const direction = Math.sign(to.x - from.x) || 1;
    const duration = DRIFT_MS + Math.min(240, Math.abs(to.x - from.x) * 0.2);
    const size = options.size();
    const fx = options.fx();

    setLean(direction * 6);
    setVar(layers.lift, "--drift-ms", `${Math.round(duration)}ms`);
    layers.lift.classList.add("is-drift");
    setRoot(to, duration, "cubic-bezier(0.4, 0, 0.2, 1)");
    at = { x: to.x, y: to.y };

    // 尾迹 3 个渐隐小点，只沿桌面出现（fx 在移动端为 null）。
    for (let index = 1; index <= 3; index += 1) {
      const progress = index / 4;
      later(() => {
        spawnTrail(
          fx,
          from.x + (to.x - from.x) * progress + size / 2,
          from.y + (to.y - from.y) * progress + size / 2 - DRIFT_RISE,
        );
      }, duration * progress);
    }

    later(() => {
      layers.lift.classList.remove("is-drift");
      layers.stance.classList.add("is-land");
      later(() => layers.stance.classList.remove("is-land"), LAND_MS + 20);
      spawnSparks(fx, to.x + size / 2, to.y + size - 6, 1);
      finish(request, to);
    }, duration + 40);
  };

  const start = (request: TravelRequest) => {
    const from = { x: at.x, y: at.y };
    const distance = Math.hypot(request.to.x - from.x, request.to.y - from.y);
    // 同一点不产生位移，直接回调，避免原地空跳。
    if (distance < 2) {
      request.onLand?.(at);
      request.onDone?.(at);
      return;
    }
    if (options.reduced()) {
      snap(request.to);
      request.onLand?.(at);
      request.onDone?.(at);
      return;
    }
    running = true;
    if (request.drift || distance >= HOP_MAX_DISTANCE) drift(request, from);
    else hop(request, from);
  };

  const snap = (to: MascotPoint) => {
    clearTimers();
    queued = null;
    running = false;
    layers.lift.classList.remove("is-hop", "is-drift");
    layers.stance.classList.remove("is-air", "is-crouch", "is-land", "is-bounce");
    setLean(0);
    setRoot(to, 0, "linear");
    at = { x: to.x, y: to.y };
  };

  const goTo = (request: TravelRequest) => {
    if (cancelled) return;
    if (running) {
      queued = request;
      return;
    }
    start(request);
  };

  const bounce = () => {
    layers.stance.classList.remove("is-bounce");
    void layers.stance.offsetWidth;
    layers.stance.classList.add("is-bounce");
    later(() => layers.stance.classList.remove("is-bounce"), 460);
  };

  const cancel = () => {
    cancelled = true;
    clearTimers();
    queued = null;
    running = false;
    layers.lift.classList.remove("is-hop", "is-drift");
    layers.stance.classList.remove("is-air", "is-crouch", "is-land", "is-bounce");
  };

  return {
    get at() {
      return { x: at.x, y: at.y };
    },
    get busy() {
      return running;
    },
    snap,
    goTo,
    face,
    bounce,
    cancel,
  };
}

function makeParticle(layer: HTMLElement, className: string, x: number, y: number): HTMLElement {
  const node = document.createElement("i");
  node.className = className;
  node.style.setProperty("--fx-x", `${Math.round(x)}px`);
  node.style.setProperty("--fx-y", `${Math.round(y)}px`);
  layer.append(node);
  const drop = () => node.remove();
  node.addEventListener("animationend", drop, { once: true });
  // animationend 在动画被暂停（切后台）时不会来，兜底定时清理。
  window.setTimeout(drop, 1000);
  return node;
}

/** 落地星光：1-2 颗四角小星，纯 opacity + transform。 */
export function spawnSparks(
  layer: HTMLElement | null,
  x: number,
  y: number,
  count = 2,
): void {
  if (!layer) return;
  for (let index = 0; index < count; index += 1) {
    const spark = makeParticle(
      layer,
      "shop-mascot-spark",
      x + random(-10, 10),
      y + random(-8, 4),
    );
    spark.style.setProperty("--fx-dx", `${Math.round(random(-16, 16))}px`);
    spark.style.setProperty("--fx-dy", `${Math.round(random(-30, -14))}px`);
    spark.style.setProperty("--fx-delay", `${Math.round(random(0, 60))}ms`);
  }
}

/** 飘移尾迹：一个慢慢消失的小点。 */
export function spawnTrail(layer: HTMLElement | null, x: number, y: number): void {
  if (!layer) return;
  makeParticle(layer, "shop-mascot-trail", x, y);
}
