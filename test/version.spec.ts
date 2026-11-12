/**
 * 版本号与存储探测的单元测试。
 * 两者都是纯逻辑，跑在 happy-dom 里即可，不需要 Nuxt 运行时。
 */
import { describe, expect, it } from 'vitest';
import { APP_VERSION, compareVersions } from '../app/utils/version';
import { checkStorageCompatibility } from '../app/utils/storage';

describe('compareVersions', () => {
  it('按主.次.修订逐段比较', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
  });

  it('段数不足按 0 补齐', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBe(-1);
  });

  it('忽略前缀 v 与预发布标签', () => {
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.0-beta.3', '2.0.0')).toBe(0);
  });
});

describe('APP_VERSION', () => {
  it('来自 package.json 的版本号（defineVitestConfig 会套用同一份 Vite define）', () => {
    // 不写死具体版本：断言「形状」而不是「当前值」，发版时不用改测试。
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('checkStorageCompatibility', () => {
  it('happy-dom 下 localStorage 与 sessionStorage 都可用', () => {
    const support = checkStorageCompatibility();
    expect(support.local).toBe(true);
    expect(support.session).toBe(true);
  });

  it('探测用的键不会留在存储里', () => {
    checkStorageCompatibility();
    expect(window.localStorage.getItem('__nomi_probe__')).toBeNull();
  });
});
