/**
 * 明暗切换的圆形揭示：只测纯几何部分。
 *
 * 真正的动画跑在 View Transitions 的伪元素上，happy-dom 里既没有伪元素也
 * 没有快照，硬测只能测到「函数被调用了」。而有意义的部分恰好是几何：
 * 圆心是不是落在被点的那颗明暗按钮上、半径够不够覆盖全屏、两个方向的裁剪层
 * 是不是反的 —— 这些错了的表现是「圆从屏幕角落冒出来」或「最后一帧留一条缝」，
 * 肉眼很难第一时间发现。
 */
import { describe, expect, it } from 'vitest';
import {
  buildRevealFrames,
  resolveRevealOrigin,
  revealRadius,
} from '../app/utils/theme-transition';

const VIEWPORT = { width: 1440, height: 900 };
/** 顶栏右上角的明暗按钮：圆心在右上，最远的角是左下。 */
const TOP_RIGHT_BUTTON = { x: 1400, y: 30 };

describe('主题揭示的圆形几何', () => {
  it('半径覆盖到离圆心最远的那个角', () => {
    const farthest = Math.hypot(TOP_RIGHT_BUTTON.x, VIEWPORT.height - TOP_RIGHT_BUTTON.y);
    expect(revealRadius(VIEWPORT, TOP_RIGHT_BUTTON)).toBeGreaterThan(farthest);
  });

  it('圆心在屏幕正中时，半径约等于半条对角线', () => {
    const center = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const halfDiagonal = Math.hypot(VIEWPORT.width / 2, VIEWPORT.height / 2);
    expect(revealRadius(VIEWPORT, center)).toBeGreaterThanOrEqual(Math.ceil(halfDiagonal));
  });

  it('两个方向共用同一个圆心（就是按钮的位置）', () => {
    const expand = buildRevealFrames('expand', VIEWPORT, TOP_RIGHT_BUTTON).frames;
    const contract = buildRevealFrames('contract', VIEWPORT, TOP_RIGHT_BUTTON).frames;
    const at = `at ${TOP_RIGHT_BUTTON.x}px ${TOP_RIGHT_BUTTON.y}px`;
    expect(expand.every((frame) => String(frame.clipPath).includes(at))).toBe(true);
    expect(contract.every((frame) => String(frame.clipPath).includes(at))).toBe(true);
  });

  it('切明亮：裁新快照，半径从 0 长到整屏', () => {
    const { target, frames } = buildRevealFrames('expand', VIEWPORT, TOP_RIGHT_BUTTON);
    expect(target).toBe('::view-transition-new(root)');
    expect(frames[0].clipPath).toBe('circle(0px at 1400px 30px)');
    expect(frames[1].clipPath).toBe(
      `circle(${revealRadius(VIEWPORT, TOP_RIGHT_BUTTON)}px at 1400px 30px)`,
    );
  });

  it('切暗黑：裁旧快照，半径从整屏缩回 0（与明亮完全反向）', () => {
    const expandFrames = buildRevealFrames('expand', VIEWPORT, TOP_RIGHT_BUTTON).frames;
    const { target, frames } = buildRevealFrames('contract', VIEWPORT, TOP_RIGHT_BUTTON);
    expect(target).toBe('::view-transition-old(root)');
    expect(frames[0].clipPath).toBe(expandFrames[1].clipPath);
    expect(frames[1].clipPath).toBe(expandFrames[0].clipPath);
  });

  it('圆心坐标取整，避免亚像素让裁剪边缘发毛', () => {
    const { frames } = buildRevealFrames('expand', VIEWPORT, { x: 1400.6, y: 30.4 });
    expect(frames[0].clipPath).toBe('circle(0px at 1401px 30px)');
  });
});

describe('圆心从哪里来', () => {
  it('拿到元素就取它的几何中心', () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () =>
      ({ left: 100, top: 40, width: 32, height: 32 }) as DOMRect;
    expect(resolveRevealOrigin(el, VIEWPORT)).toEqual({ x: 116, y: 56 });
  });

  it('拿到现成坐标就直接用（触屏场景）', () => {
    expect(resolveRevealOrigin({ x: 12, y: 34 }, VIEWPORT)).toEqual({ x: 12, y: 34 });
  });

  it('什么都没有就退回视口中心，不能因为缺圆心就不切主题', () => {
    expect(resolveRevealOrigin(undefined, VIEWPORT)).toEqual({ x: 720, y: 450 });
    expect(resolveRevealOrigin(null, VIEWPORT)).toEqual({ x: 720, y: 450 });
  });

  it('元素还没布局（宽高为 0）时同样退回视口中心', () => {
    // 抽屉里刚渲染、尚未测量的按钮，getBoundingClientRect 全是 0。
    const el = document.createElement('button');
    expect(resolveRevealOrigin(el, VIEWPORT)).toEqual({ x: 720, y: 450 });
  });
});
