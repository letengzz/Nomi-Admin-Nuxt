/**
 * 表格外观的消费方 —— 把 table store 的开关翻成 class 列表。
 *
 * 本项目的表格是原生 `<table class="nomi-table">`（不是 el-table），所以偏好
 * 不能通过 props 传，只能落到 class 上，再由 layout.scss 里的变体规则接管。
 *
 * 页面写法：
 * ```html
 * <table class="nomi-table" :class="tableClass">
 * ```
 * 页面不解释「斑马纹该加什么类」，改视觉只改一处。
 */
import { computed } from 'vue';
import { useTableStore } from '../stores/table';

export function useTableStyle() {
  const table = useTableStore();

  const tableClass = computed(() => ({
    'is-zebra': table.state.isZebra,
    'is-border': table.state.isBorder,
    'is-header-bg': table.state.isHeaderBackground,
    [`is-${table.state.tableSize}`]: true,
  }));

  return { table, tableClass };
}
