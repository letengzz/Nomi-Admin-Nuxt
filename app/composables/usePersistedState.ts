/**
 * 持久化 store 的统一入口 —— 取代 docs/状态管理.md 第 1 章的
 * `pinia-plugin-persistedstate`。
 *
 * 为什么不用那个插件：它要额外装一个依赖，而本项目本来就有 @vueuse/core 的
 * useStorage（sette 项目里已经在用它读写主题偏好）。useStorage 自带跨标签页
 * 同步、序列化器和 SSR 兜底，插件的能力在这套项目里几乎都是重复实现。
 *
 * 但 useStorage 单用会踩两个坑，这个函数就是为了把两个坑一次性堵住：
 *
 *  ① **水合覆盖**：SSR 读不到 localStorage，store 里是默认值，这份默认值会随
 *     payload 发到浏览器；水合时 Pinia 拿它覆盖 ref，随后 useStorage 的 watch
 *     又把默认值写回存储 —— 用户调好的偏好在刷新一次之后被永久改掉。
 *     解法是 skipHydrate（详见 app/stores/setting.ts 的长注释）。
 *
 *  ② **老用户存储缺字段**：新版本给 store 加一个字段，老存储里没有它，
 *     `state.value.showWorkTab` 会是 undefined 而不是默认值。mergeDefaults
 *     会把默认值并进来。
 *
 * 用法（只能在 setup store 内调用，skipHydrate 依赖 store 上下文）：
 *
 * ```ts
 * const state = usePersistedState<LayoutState>('layout', { ...LAYOUT_DEFAULTS }, {
 *   legacyKeys: [legacyStorageKey('layout')],
 * });
 * ```
 */
import { useStorage, type RemovableRef } from '@vueuse/core';
import { skipHydrate } from 'pinia';
import { migrateLegacyKeys, storageKey } from '../utils/storage-key';

export interface PersistOptions<T> {
  /** 版本化之前的老键，首次读取时搬迁并删除。 */
  legacyKeys?: readonly string[];
  /**
   * 自定义合并策略。默认是 useStorage 的浅合并（`{ ...默认值, ...存储值 }`）。
   * 持久化结构里有嵌套对象时要传自定义函数，否则老存储的嵌套对象会整个替换掉
   * 默认值里的新字段。
   */
  merge?: (stored: T, defaults: T) => T;
  /** 关闭默认值合并（只对数组或标量有意义）。 */
  mergeDefaults?: boolean;
}

export function usePersistedState<T>(
  name: string,
  defaults: T,
  options: PersistOptions<T> = {},
): RemovableRef<T> {
  const key = storageKey(name);

  if (options.legacyKeys?.length) {
    migrateLegacyKeys(key, options.legacyKeys);
  }

  const state = useStorage<T>(key, defaults, undefined, {
    // useStorage 允许 mergeDefaults 传函数；不传时退化为浅合并。
    mergeDefaults: options.merge ?? options.mergeDefaults ?? true,
  });

  return skipHydrate(state);
}
