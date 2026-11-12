/**
 * 主题设置的持久化行为。
 *
 * 守的是一条「看起来没问题」的链路：SSR 期间读不到 localStorage，store 里是默认值，
 * 这份默认值会随 payload 进浏览器；水合阶段 Pinia 会拿它**覆盖** ref 的当前值，
 * 而 useStorage 在 createStore 阶段已经把真实偏好读进来了。覆盖一旦生效，
 * useStorage 的 watch 会把默认值写回 localStorage —— 用户手点几下完全看不出异常，
 * 但刷新一次偏好就被永久改掉。这条断言就是为了拦住它。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useSettingStore } from '../app/stores/setting';
import { THEME_STORAGE_KEYS } from '../shared/utils/theme-bootstrap';

/** 模拟 Nuxt 把 SSR 快照塞回客户端（pinia.state.value 先于 store 创建就位）。 */
function hydrateWithServerSnapshot(state: Record<string, unknown>): void {
  const pinia = createPinia();
  pinia.state.value = { setting: state };
  setActivePinia(pinia);
}

describe('setting store 的持久化', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('水合不会用 SSR 快照覆盖 localStorage 里的真实偏好', () => {
    localStorage.setItem(THEME_STORAGE_KEYS.mode, 'dark');
    localStorage.setItem(THEME_STORAGE_KEYS.color, '#60C041');
    hydrateWithServerSnapshot({ colorMode: 'auto', themeColor: '#5D87FF' });

    const store = useSettingStore();

    expect(store.colorMode).toBe('dark');
    expect(store.themeColor).toBe('#60C041');
    // 真正的伤害在这里：默认值被写回存储，下一次刷新就再也读不回用户的选择。
    expect(localStorage.getItem(THEME_STORAGE_KEYS.mode)).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEYS.color)).toBe('#60C041');
  });

  it('切换后写回 localStorage，且是裸字符串（与 <head> 内联脚本的读法一致）', async () => {
    const store = useSettingStore();

    store.setColorMode('dark');
    await nextTick();

    expect(localStorage.getItem(THEME_STORAGE_KEYS.mode)).toBe('dark');

    store.setThemeColor('#60C041');
    await nextTick();

    expect(localStorage.getItem(THEME_STORAGE_KEYS.color)).toBe('#60C041');
  });
});
