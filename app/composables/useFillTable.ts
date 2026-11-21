import { computed, ref } from 'vue';
import { useElementSize, useMediaQuery } from '@vueuse/core';

/**
 * 让 ElTable 占满外层容器，把**滚动留在表体**里。
 *
 * 为什么不能只靠 CSS：ElTable 只有在拿到具体高度（`height` prop）时才会给
 * 表体设 `overflow: auto` 并算出表体高度；父容器写的 `flex: 1` 它不认。
 * 传 `height="100%"` 在 flex 容器里时灵时不灵（百分比高度要看祖先链是否定高），
 * 所以这里用 ResizeObserver 量出容器的像素高度再传数字，行为可预期。
 *
 * 手机端（≤800px）布局会把 `#app-main` 的滚动交还给页面（见 layout.scss），
 * 此时不能锁死表格高度，否则数据变化后表格不会跟着长高 —— 所以窄屏直接
 * 返回 undefined，让表格回到自然高度、整页滚动。
 */
export function useFillTable() {
  const wrapRef = ref<HTMLElement>();
  const { height } = useElementSize(wrapRef);
  // 与 layout.scss 的 800px 断点保持一致。
  const isWide = useMediaQuery('(min-width: 801px)');

  const tableHeight = computed(() =>
    isWide.value && height.value > 0 ? Math.floor(height.value) : undefined,
  );

  return { wrapRef, tableHeight };
}
