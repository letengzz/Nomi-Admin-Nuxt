/**
 * 表格 store —— docs/状态管理.md 第 6 章（table.ts，98 行）。
 *
 * 管的是「表格看起来怎么样」这类跨越页面的偏好：尺寸、斑马纹、边框、表头底色。
 * 放进 store 而不是每个页面各写一份 props，才有「在订单页调好，用户页也是同一个
 * 观感」的效果，刷新后还能记住。
 *
 * 与文档的差异：文档只记 `tableSize` 一个尺寸，这里额外允许 `isHeaderBackground`
 * 单独开关，因为本项目的表格是原生 <table>（`.nomi-table`），表头底色与边框
 * 是两条独立的视觉线索，合成一个开关反而表达不了。
 *
 * 消费方：app/composables/useTableStyle.ts 把它翻成 class 列表，
 * 页面只写 `<table class="nomi-table" :class="tableClass">`。
 */
import { defineStore } from 'pinia';
import { usePersistedState } from '../composables/usePersistedState';
import { storageKey } from '../utils/storage-key';

export const TableSizeEnum = {
  LARGE: 'large',
  DEFAULT: 'default',
  SMALL: 'small',
} as const;
export type TableSize = (typeof TableSizeEnum)[keyof typeof TableSizeEnum];

export interface TableState {
  tableSize: TableSize;
  isZebra: boolean;
  isBorder: boolean;
  isHeaderBackground: boolean;
  isFullScreen: boolean;
}

export const TABLE_DEFAULTS: TableState = {
  tableSize: TableSizeEnum.DEFAULT,
  isZebra: false,
  isBorder: false,
  isHeaderBackground: false,
  isFullScreen: false,
};

export const TABLE_STORAGE_KEY = storageKey('table');

export const useTableStore = defineStore('table', () => {
  const state = usePersistedState<TableState>('table', { ...TABLE_DEFAULTS });

  function setTableSize(size: TableSize): void {
    state.value = { ...state.value, tableSize: size };
  }

  function setIsZebra(value: boolean): void {
    state.value = { ...state.value, isZebra: value };
  }

  function setIsBorder(value: boolean): void {
    state.value = { ...state.value, isBorder: value };
  }

  function setIsHeaderBackground(value: boolean): void {
    state.value = { ...state.value, isHeaderBackground: value };
  }

  function setIsFullScreen(value: boolean): void {
    state.value = { ...state.value, isFullScreen: value };
  }

  function toggleZebra(): void {
    setIsZebra(!state.value.isZebra);
  }

  /** 一键回到最「干净」的观感：默认尺寸、无斑马纹、无边框。 */
  function reset(): void {
    state.value = { ...TABLE_DEFAULTS };
  }

  return {
    state,
    setTableSize,
    setIsZebra,
    setIsBorder,
    setIsHeaderBackground,
    setIsFullScreen,
    toggleZebra,
    reset,
  };
});
