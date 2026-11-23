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

import {
  REMEMBER_LOGIN_KEY,
  REMEMBERED_ACCOUNT_KEY,
  REMEMBERED_PASSWORD_KEY,
} from '../constants/auth';

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

/** 登录页「记住密码」的持久化结果：账号、密码与勾选状态。 */
export interface RememberLoginChoice {
  remember: boolean;
  account: string;
  password: string;
}

/**
 * 口令存储用的可逆编码，仅为避免 localStorage 里出现裸明文。
 *
 * 明确声明：这不是安全措施。密钥混在前端代码里，任何人拿到同源存储都能还原，
 * 真正挡住窃取的是同源策略 + XSS 防护；要想交出凭据请依赖浏览器密码管理器
 * （登录框已开启 autocomplete=current-password）。这里编码的唯一目的是
 * 「翻 localStorage 时不会一眼看到密码」，并让密码里出现引号 / 换行也安全。
 */
const PASSWORD_MASK = 0x5a;

function encodePassword(password: string): string {
  if (!password) return '';
  const bytes = new TextEncoder().encode(password);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte ^ PASSWORD_MASK);
  return btoa(binary);
}

function decodePassword(encoded: string): string {
  if (!encoded) return '';
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0) ^ PASSWORD_MASK);
    return new TextDecoder().decode(bytes);
  } catch {
    // 老数据 / 被手工改坏的值：宁可回填空密码，也不能让整个登录页崩掉。
    return '';
  }
}

/**
 * 读取「记住密码」设置。
 *
 * 没写过勾选键时默认勾选（沿用登录页初始值），这样老用户升级后仍会回填账号；
 * 显式取消过一次后，就算还残留账号也不回填 —— 否则用户会以为取消没生效。
 */
export function readRememberLogin(
  storage: Storage | undefined = canUseStorage() ? window.localStorage : undefined,
): RememberLoginChoice {
  if (!storage) return { remember: true, account: '', password: '' };

  const raw = storage.getItem(REMEMBER_LOGIN_KEY);
  const remember = raw === null ? true : raw === '1';
  if (!remember) {
    storage.removeItem(REMEMBERED_ACCOUNT_KEY);
    storage.removeItem(REMEMBERED_PASSWORD_KEY);
    return { remember, account: '', password: '' };
  }
  return {
    remember,
    account: storage.getItem(REMEMBERED_ACCOUNT_KEY) ?? '',
    password: decodePassword(storage.getItem(REMEMBERED_PASSWORD_KEY) ?? ''),
  };
}

/**
 * 保存「记住密码」设置。勾选才留账号与密码，不勾选时连残留值一起清掉。
 *
 * 密码走可逆编码，避免裸明文落盘；调用方传的一律是用户刚输入的原文。
 */
export function saveRememberLogin(
  account: string,
  remember: boolean,
  password: string = '',
  storage: Storage | undefined = canUseStorage() ? window.localStorage : undefined,
): void {
  if (!storage) return;
  storage.setItem(REMEMBER_LOGIN_KEY, remember ? '1' : '0');
  if (remember) {
    storage.setItem(REMEMBERED_ACCOUNT_KEY, account);
    storage.setItem(REMEMBERED_PASSWORD_KEY, encodePassword(password));
  } else {
    storage.removeItem(REMEMBERED_ACCOUNT_KEY);
    storage.removeItem(REMEMBERED_PASSWORD_KEY);
  }
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
