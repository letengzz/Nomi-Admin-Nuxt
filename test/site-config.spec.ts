/**
 * 站点公开配置的归一化单测。
 *
 * 环境标识来自数据库里的自由字符串（后台下拉只约束新写入，历史值不受控），
 * 所以「认不出来的值怎么办」必须有确定答案：当开发环境，角标仍然显示。
 * 这里只测纯函数，不碰 $fetch —— 接口层的兜底靠默认值合并，逻辑同样在这层。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_INFO, envUrlOf, normalizeEnv } from '../app/services/site';

describe('normalizeEnv', () => {
  it('三档合法值原样返回', () => {
    expect(normalizeEnv('production')).toBe('production');
    expect(normalizeEnv('testing')).toBe('testing');
    expect(normalizeEnv('development')).toBe('development');
  });

  it('脏值 / 空值 / 大小写不符一律当开发环境', () => {
    expect(normalizeEnv('PROD')).toBe('development');
    expect(normalizeEnv('')).toBe('development');
    expect(normalizeEnv(undefined)).toBe('development');
    expect(normalizeEnv(null)).toBe('development');
  });
});

describe('envUrlOf', () => {
  const env = { current: 'production', showBadge: true, devUrl: 'https://dev.x', testUrl: 'https://test.x', prodUrl: 'https://prod.x' };

  it('取当前环境对应的地址', () => {
    expect(envUrlOf(env, 'production')).toBe('https://prod.x');
    expect(envUrlOf(env, 'testing')).toBe('https://test.x');
    expect(envUrlOf(env, 'development')).toBe('https://dev.x');
  });

  it('认不出的环境按开发环境取地址', () => {
    expect(envUrlOf(env, 'staging')).toBe('https://dev.x');
  });

  it('地址为空时返回空串（canonical 会因此不输出）', () => {
    expect(envUrlOf({ ...env, prodUrl: '  ' }, 'production')).toBe('');
  });
});

describe('DEFAULT_SITE_INFO', () => {
  it('默认不收录、不输出分享图，避免后台被搜索引擎抓走', () => {
    expect(DEFAULT_SITE_INFO.seo.allowIndexing).toBe(false);
    expect(DEFAULT_SITE_INFO.seo.ogImage).toBe('');
    expect(DEFAULT_SITE_INFO.environment.current).toBe('development');
  });
});
