/**
 * 版本化存储键 —— docs/状态管理.md 第 1 章 `StorageKeyManager` 的等价实现。
 *
 * 键格式：`nomi:v1:layout`（前缀 : schema 版本 : store 名）。
 *
 * 与文档的一处刻意偏离：文档用**应用版本**做键（`sys-v3.0.2-setting`），这里用
 * schema 版本。应用每发一个小版本就把偏好键全换掉，等于每次升级都把主题、布局、
 * 标签页重置一遍 —— 而版本段的本来用途是「数据结构变了才丢弃旧值」，那属于
 * schema 的事。所以版本号由 STORAGE_SCHEMA_VERSION 手动推进：只有真的改了
 * 持久化结构才 +1。
 *
 * 另一处补充：文档没有处理老键。本项目的键本来就长这样（`nomi:layout`、
 * `nomi:worktabs`、`nomi:access-token`），直接换成带版本段的新键会让已有用户
 * 丢一次偏好，所以首次读取时做一次搬迁（migrateLegacyKeys / takeLegacyValue）。
 *
 * 这里只做字符串读写，不依赖 Vue / Nuxt，纯 vitest 环境同样可用。
 */

export const STORAGE_PREFIX = 'nomi';

/** 持久化结构版本。改了某个 store 的持久化形状就 +1，旧值会在读不到时退回默认值。 */
export const STORAGE_SCHEMA_VERSION = 1;

/** `layout` → `nomi:v1:layout` */
export function storageKey(name: string, version: number = STORAGE_SCHEMA_VERSION): string {
  return `${STORAGE_PREFIX}:v${version}:${name}`;
}

/** 版本化之前的老键：`layout` → `nomi:layout` */
export function legacyStorageKey(name: string): string {
  return `${STORAGE_PREFIX}:${name}`;
}

/** SSR 与「隐私模式下 localStorage 直接抛错」都要靠它兜住。 */
export function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * 把老键的值搬到新键，然后删除老键。
 *
 * 只在**新键不存在**时搬 —— 新键已存在说明已经迁移过（或用户已经用过新版本），
 * 这时老键只是残留，删掉即可，绝不能反向覆盖新值。
 *
 * 返回是否发生了搬迁，方便启动插件打日志。
 */
export function migrateLegacyKeys(
  targetKey: string,
  legacyKeys: readonly string[],
  storage: Storage | undefined = canUseStorage() ? window.localStorage : undefined,
): boolean {
  if (!storage || legacyKeys.length === 0) return false;

  let migrated = false;
  const targetMissing = storage.getItem(targetKey) === null;

  for (const legacy of legacyKeys) {
    const raw = storage.getItem(legacy);
    if (raw === null) continue;
    // 老值的序列化格式必须与新键一致（都是 JSON），否则搬过去反而读不出来。
    // useStorage 对对象/数组都走 JSON.stringify，所以 layout / worktab 可以直搬。
    if (targetMissing && !migrated) {
      storage.setItem(targetKey, raw);
      migrated = true;
    }
    storage.removeItem(legacy);
  }
  return migrated;
}

/**
 * 读取并删除一个老键（单值形态，如 `nomi:access-token` 存的是裸字符串）。
 *
 * user store 的老状态分散在多个键里，拼不成一个对象，只能逐个取值后重新组装，
 * 所以这里不复用 migrateLegacyKeys。
 */
export function takeLegacyValue<T>(
  name: string,
  storage: Storage | undefined = canUseStorage() ? window.localStorage : undefined,
): T | undefined {
  if (!storage) return undefined;
  const key = legacyStorageKey(name);
  const raw = storage.getItem(key);
  if (raw === null) return undefined;
  storage.removeItem(key);
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 历史上直接写裸字符串（没有引号）的情况：按原样返回，宁可多留一次偏好。
    return raw as unknown as T;
  }
}

/**
 * 清掉不属于当前 schema 版本的键。
 *
 * 只在启动时调用一次。不做这件事的后果是：每次改持久化结构，localStorage 里
 * 都会多留一份永远不会再被读到的副本，直到撞上 5MB 配额 —— 而配额打满时
 * 表现是「设置改了保存不上」，很难反查到是旧键占着地方。
 *
 * 返回被清掉的键名，便于开发期打印。
 */
export function purgeOutdatedStorage(
  version: number = STORAGE_SCHEMA_VERSION,
  storage: Storage | undefined = canUseStorage() ? window.localStorage : undefined,
): string[] {
  if (!storage) return [];
  const pattern = new RegExp(`^${STORAGE_PREFIX}:v(\\d+):`);
  const removed: string[] = [];

  // 先收集再删除：遍历时删除会让索引错位，跳过元素。
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const matched = pattern.exec(key);
    if (matched && Number(matched[1]) !== version) removed.push(key);
  }
  for (const key of removed) storage.removeItem(key);
  return removed;
}
