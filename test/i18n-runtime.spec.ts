/**
 * 运行期 i18n 纯逻辑的单测。
 *
 * 这三段逻辑决定「页面上的每个字从哪来」，一旦跑偏就是整站文案错乱，
 * 所以不依赖组件、直接钉死输入输出。
 */
import { describe, expect, it } from 'vitest';
import {
  isI18nEntryKey,
  mergeMessages,
  resolveNavigationLocale,
  resolvePreferredLocale,
} from '../shared/utils/i18n';

describe('isI18nEntryKey', () => {
  it('点分词条键才算键', () => {
    expect(isI18nEntryKey('layout.menu.users')).toBe(true);
    expect(isI18nEntryKey('a.b')).toBe(true);
    expect(isI18nEntryKey('  auth.user.title  ')).toBe(true);
    expect(isI18nEntryKey('menu_users-2.title')).toBe(true);
  });

  it('自然文案、单词、非法字符都不当键', () => {
    for (const value of ['用户管理', 'User Management', 'dashboard', '.a', 'a..b', 'a/b', '']) {
      expect(isI18nEntryKey(value)).toBe(false);
    }
    expect(isI18nEntryKey(undefined)).toBe(false);
    expect(isI18nEntryKey(123)).toBe(false);
  });
});

describe('mergeMessages', () => {
  it('深层覆盖，未覆盖的保留', () => {
    const base = { layout: { menu: { users: '用户', roles: '角色' } }, app: { title: 'Nomi' } };
    const merged = mergeMessages(base, { layout: { menu: { users: '会员' } } });
    expect(merged).toEqual({
      layout: { menu: { users: '会员', roles: '角色' } },
      app: { title: 'Nomi' },
    });
  });

  it('不修改入参（快照必须保持静态原文）', () => {
    const base = { a: { b: '内置' } };
    mergeMessages(base, { a: { b: '数据库' } });
    expect(base.a.b).toBe('内置');
  });

  it('类型不一致时用新值整体替换', () => {
    const merged = mergeMessages({ a: { b: 'x' } }, { a: 'y' });
    expect(merged.a).toBe('y');
  });
});

describe('resolveNavigationLocale', () => {
  it('站内导航按用户偏好纠正无前缀路径误判的语言', () => {
    expect(resolveNavigationLocale('zh', 'en', false)).toBe('en');
  });

  it('首屏保留 URL 判定的语言，不被本地偏好覆盖', () => {
    expect(resolveNavigationLocale('en', 'zh', true)).toBe('en');
  });

  it('偏好为空或与判定一致时原样返回', () => {
    expect(resolveNavigationLocale('zh', '', false)).toBe('zh');
    expect(resolveNavigationLocale('en', 'en', false)).toBe('en');
  });
});

describe('resolvePreferredLocale', () => {
  it('非默认语言才强制覆盖 URL 判定', () => {
    expect(resolvePreferredLocale('ja', ['zh', 'en', 'ja'], 'zh')).toBe('ja');
  });

  it('默认语言交给 URL 判定，避免把 /en 打回中文', () => {
    expect(resolvePreferredLocale('zh', ['zh', 'en'], 'zh')).toBeNull();
  });

  it('偏好语言已停用时返回 null，由调用方回落', () => {
    expect(resolvePreferredLocale('ko', ['zh', 'en'], 'zh')).toBeNull();
  });
});
