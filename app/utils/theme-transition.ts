/**
 * 明暗切换的「圆形揭示」动效。
 *
 * 用 View Transitions 拿到「切换前 / 切换后」两帧快照，再用 clip-path: circle()
 * 把其中一帧裁成一个**以明暗按钮为圆心**的圆：
 *
 *   切到明亮  expand   —— 亮色从按钮位置长成整屏，暗色被逐渐推开
 *   切到暗黑  contract —— 暗色在下层，亮色缩回按钮位置，亮色被逐渐吸走
 *
 * 两个方向共用同一个圆心，所以观感上是同一段圆弧的「正向」与「倒放」。
 * 半径取「圆心到最远那个角」，圆一定会先铺满整屏再收尾，不会留缺口。
 *
 * 为什么不用 CSS 过渡：主题是 <html> 上的一堆变量 + 一个 .dark 类，任何
 * transition 都只能让颜色插值，做不出「一块区域先变、另一块后变」。快照裁剪
 * 才能让变化有明确的前锋边缘，也让「从哪儿开始变」变得可控。
 *
 * 不支持 View Transitions（老 Firefox / 老 Safari）或用户要求减少动效时，
 * 直接同步应用并返回 —— 主题切换是功能，不是装饰，不能因为动画失败就不切。
 */

/** expand：新主题从按钮铺开；contract：旧主题缩回按钮。 */
export type RevealMode = 'expand' | 'contract';

export interface RevealViewport {
  width: number;
  height: number;
}

/** 圆心，视口坐标系（与 clip-path 的坐标系一致，即 getBoundingClientRect 那套）。 */
export interface RevealOrigin {
  x: number;
  y: number;
}

/** 动效时长（ms）。再长用户会觉得点击有延迟，再短看不清圆弧。 */
export const REVEAL_DURATION = 480;

/** 起手快、收尾慢：圆形扩张用 ease-out 比 linear 自然，边缘不会「刹停」。 */
export const REVEAL_EASING = 'cubic-bezier(0.33, 0, 0.2, 1)';

/**
 * 裁的是哪一层。
 *
 * 默认新快照压在旧快照上面，所以「展开」裁新的那层就行；
 * 「收缩」要裁旧的那层，并且得先用 .nomi-reveal-contract 把它提到上层
 * （见 app.vue 里的样式），否则旧层被新层整块盖住，缩了也看不见。
 */
export type RevealTarget = '::view-transition-new(root)' | '::view-transition-old(root)';

function isPoint(value: unknown): value is RevealOrigin {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Partial<RevealOrigin>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * 圆心从「调用方给的东西」里取。
 *
 * 常态是按钮元素 —— 取它的几何中心，圆就从按钮本体上冒出来；
 * 也接受现成坐标（例如触屏场景想用触点）；两者都给不出时退回视口中心，
 * 宁可位置不完美，也不能因为没有圆心就不切主题。
 */
export function resolveRevealOrigin(anchor: unknown, viewport: RevealViewport): RevealOrigin {
  if (typeof Element !== 'undefined' && anchor instanceof Element) {
    const rect = anchor.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }
  if (isPoint(anchor)) return { x: anchor.x, y: anchor.y };
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

/** 圆心 → 最远的那个角。多留 2px 免得最后一帧边缘露出缝。 */
export function revealRadius(viewport: RevealViewport, origin: RevealOrigin): number {
  const dx = Math.max(Math.abs(origin.x), Math.abs(viewport.width - origin.x));
  const dy = Math.max(Math.abs(origin.y), Math.abs(viewport.height - origin.y));
  return Math.ceil(Math.hypot(dx, dy)) + 2;
}

/**
 * 算出要裁剪的层与两端关键帧。纯函数，viewport / origin 由调用方传入，方便单测。
 */
export function buildRevealFrames(
  mode: RevealMode,
  viewport: RevealViewport,
  origin: RevealOrigin,
): { target: RevealTarget; frames: Keyframe[] } {
  const at = `at ${Math.round(origin.x)}px ${Math.round(origin.y)}px`;
  const radius = revealRadius(viewport, origin);
  const open = `circle(${radius}px ${at})`;
  const closed = `circle(0px ${at})`;
  const expand = mode === 'expand';
  return {
    target: expand ? '::view-transition-new(root)' : '::view-transition-old(root)',
    frames: expand
      ? [{ clipPath: closed }, { clipPath: open }]
      : [{ clipPath: open }, { clipPath: closed }],
  };
}

/** 收缩模式需要把旧快照提到上层，类名与 app.vue 里的样式一一对应。 */
const REVEAL_CONTRACT_CLASS = 'nomi-reveal-contract';

/** 兜底摘类的时限：动画结束事件没来（被跳过 / 被打断）也不让类留在 <html> 上。 */
const CLEANUP_TIMEOUT = REVEAL_DURATION + 400;

function canReveal(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  // 老浏览器没有这个方法，直接退化成「瞬间切换」。
  if (typeof document.startViewTransition !== 'function') return false;
  // 动效是装饰，系统说减少动效就乖乖不做。
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  return true;
}

/**
 * 执行一次主题切换：apply 里同步改状态 + 写 <html>，外面套一层圆形揭示。
 *
 * apply 必须同步改完 DOM（本项目里是 applyThemeToDocument 直接写 class 与变量），
 * 因为「新快照」是在回调返回后的下一帧拍的，异步改就拿不到新样子。
 *
 * anchor 一般是 handleMoreCommand / @click 传下来的 `$event.currentTarget`，
 * 也就是用户点的那颗明暗按钮。
 */
export function revealTheme(mode: RevealMode, apply: () => void, anchor?: unknown): void {
  if (!canReveal()) {
    apply();
    return;
  }

  const viewport: RevealViewport = { width: window.innerWidth, height: window.innerHeight };
  const origin = resolveRevealOrigin(anchor, viewport);
  const root = document.documentElement;
  const cleanup = (): void => root.classList.remove(REVEAL_CONTRACT_CLASS);
  if (mode === 'contract') root.classList.add(REVEAL_CONTRACT_CLASS);

  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(apply);
  } catch {
    // 快照失败（例如页面正在卸载）不能让主题停在旧值上。
    cleanup();
    apply();
    return;
  }

  const { target, frames } = buildRevealFrames(mode, viewport, origin);

  transition.ready
    .then(() => {
      const animation = root.animate(frames, {
        duration: REVEAL_DURATION,
        easing: REVEAL_EASING,
        // 关键：把动画挂到 view-transition 的伪元素上，而不是 <html> 本身。
        pseudoElement: target,
      });
      animation.addEventListener('finish', cleanup, { once: true });
      animation.addEventListener('cancel', cleanup, { once: true });
    })
    .catch(cleanup);

  // 过渡被浏览器跳过时（连续快速点击）ready 也会 resolve，动画不会跑，
  // finish 事件就不会来，所以这里再挂一道时限兜底。
  window.setTimeout(cleanup, CLEANUP_TIMEOUT);
}
