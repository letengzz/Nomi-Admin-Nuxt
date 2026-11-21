/**
 * 页面级移动端断点。
 *
 * 与全局机制保持同一套数字：layout.scss 的 800px 断点、`useFillTable` 的
 * `(min-width: 801px)`、以及 `isMobileWidth()` 都在这里收口，避免某个页面
 * 自己写一个 768/820 的阈值，出现「表格已经退化成自然高度、左栏还占着
 * 300px」这种错位。
 *
 * 只用来裁剪**展示**（固定列、次要列、弹窗尺寸）；数据范围与操作权限
 * 一律由服务端判定，窄屏不改变任何权限语义。
 */
import { computed } from 'vue';
import { useWindowSize } from '@vueuse/core';
import { isMobileWidth } from './useLayout';

export const NARROW_BREAKPOINT = 640;

export function useMobileLayout() {
  const { width } = useWindowSize();

  return {
    /** ≤800px：侧栏已变抽屉、表格不再定高，页面按文档流排布 */
    isMobile: computed(() => isMobileWidth(width.value)),
    /** ≤640px：内容区留白收紧，工具栏/弹窗需要进一步压缩 */
    isNarrow: computed(() => width.value > 0 && width.value <= NARROW_BREAKPOINT),
  };
}
