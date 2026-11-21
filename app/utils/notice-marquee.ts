/**
 * 顶部公告滚动条的纯计算逻辑（不依赖 DOM / Vue，便于单测）。
 * 组件只负责测量宽度与驱动定时器，判定都在这里。
 */

/**
 * 跑马灯位移：文字溢出容器时返回需要向左平移的像素（负值），
 * 未溢出返回 0。配合 CSS animation-direction: alternate 做往返滚动，
 * 避免「滚到头突然跳回起点」的突兀感。
 */
export function marqueeOffset(scrollWidth: number, clientWidth: number): number {
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(clientWidth)) return 0;
  if (clientWidth <= 0 || scrollWidth <= clientWidth) return 0;
  return -(scrollWidth - clientWidth);
}

/** 轮播下一条下标；不足两条时保持原位，避免单条也「切换」闪一下。 */
export function nextCarouselIndex(current: number, length: number): number {
  if (length <= 1) return 0;
  return (current + 1) % length;
}
