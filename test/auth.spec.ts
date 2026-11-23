/**
 * 登录页支撑层单测：主题色计算、演示账号、错误信息提取。
 * 全部是纯函数，跑在 happy-dom 环境里，不需要拉起 Nuxt 运行时。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  REMEMBERED_ACCOUNT_KEY,
  REMEMBERED_PASSWORD_KEY,
  REMEMBER_LOGIN_KEY,
} from '../app/constants/auth';
import { buildPrimaryVars, mixColor, THEME_COLORS } from '../app/utils/theme';
import { getErrorMessage } from '../app/services/auth';
import { readRememberLogin, saveRememberLogin } from '../app/utils/storage-key';
import { buildLoginLookup } from '../server/utils/auth/session';

describe('主题色工具', () => {
  it('mixColor 的边界权重返回对应纯色', () => {
    expect(mixColor('#FFFFFF', '#000000', 1)).toBe('#FFFFFF');
    expect(mixColor('#FFFFFF', '#000000', 0)).toBe('#000000');
    expect(mixColor('#FFFFFF', '#FFFFFF', 0.5)).toBe('#FFFFFF');
  });

  it('mixColor 会按权重线性混合通道', () => {
    expect(mixColor('#FFFFFF', '#000000', 0.5)).toBe('#808080');
  });

  it('有 7 个预设主色且互不重复', () => {
    expect(THEME_COLORS).toHaveLength(7);
    expect(new Set(THEME_COLORS).size).toBe(7);
  });

  it('buildPrimaryVars 生成 Element Plus 主色与 1..9 级浅色', () => {
    const vars = buildPrimaryVars('#5D87FF', false);
    expect(vars['--el-color-primary']).toBe('#5D87FF');
    expect(vars['--main-color']).toBe('#5D87FF');
    for (let i = 1; i <= 9; i += 1) {
      expect(vars[`--el-color-primary-light-${i}`]).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(vars['--el-color-primary-dark-2']).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('明色 light-9 比 light-3 更接近白色', () => {
    const vars = buildPrimaryVars('#5D87FF', false);
    const lightness = (hex: string) => Number.parseInt((hex ?? '').slice(1, 3), 16);
    expect(lightness(vars['--el-color-primary-light-9'])).toBeGreaterThan(
      lightness(vars['--el-color-primary-light-3']),
    );
  });
});

describe('演示账号', () => {
  it('三个演示账号分别挂在三个不同的部门下（登录页选择器按部门填账号）', () => {
    expect(DEMO_ACCOUNTS.map((account) => account.userName)).toEqual(['super', 'admin', 'user']);
    const departments = DEMO_ACCOUNTS.map((account) => account.departmentId);
    expect(new Set(departments).size).toBe(DEMO_ACCOUNTS.length);
    expect(departments.every((id) => id > 0)).toBe(true);
  });

  it('演示密码与服务端白名单一致', () => {
    expect(DEMO_PASSWORD).toBe('123456');
  });
});

describe('getErrorMessage', () => {
  it('优先取接口 data.msg', () => {
    expect(getErrorMessage({ data: { msg: '账号或密码错误' } })).toBe('账号或密码错误');
  });

  it('兼容字符串 data 与普通 Error', () => {
    expect(getErrorMessage({ data: '服务不可用' })).toBe('服务不可用');
    expect(getErrorMessage(new Error('网络异常'))).toBe('网络异常');
  });

  it('未知错误返回兜底文案', () => {
    expect(getErrorMessage(null)).toBe('登录失败，请稍后重试');
  });
});

describe('登录标识', () => {
  it('登录名 / 手机号 / 邮箱三者都能匹配，且登录名优先', () => {
    const lookup = buildLoginLookup('  Super@Nomi.dev  ');
    expect(lookup.params).toEqual(['Super@Nomi.dev', 'Super@Nomi.dev', 'Super@Nomi.dev']);
    expect(lookup.where).toContain('`username` = ?');
    expect(lookup.where).toContain('`mobile` = ?');
    expect(lookup.where).toContain('LOWER(`email`)');
    expect(lookup.order).toContain('(`username` = ?) DESC');
    expect(lookup.order).toContain('(`mobile` = ?) DESC');
  });
});

describe('记住密码偏好', () => {
  afterEach(() => {
    localStorage.removeItem(REMEMBER_LOGIN_KEY);
    localStorage.removeItem(REMEMBERED_ACCOUNT_KEY);
    localStorage.removeItem(REMEMBERED_PASSWORD_KEY);
  });

  it('首次访问默认勾选，但没有账号密码可回填', () => {
    expect(readRememberLogin()).toEqual({ remember: true, account: '', password: '' });
  });

  it('勾选时保存账号与密码，读回来原样回填', () => {
    saveRememberLogin('nomi', true, 'p@ss中文"引号');
    expect(readRememberLogin()).toEqual({
      remember: true,
      account: 'nomi',
      password: 'p@ss中文"引号',
    });
  });

  it('密码不裸明文落盘', () => {
    saveRememberLogin('nomi', true, 'plain-secret');
    expect(localStorage.getItem(REMEMBERED_PASSWORD_KEY)).not.toBe('plain-secret');
    expect(localStorage.getItem(REMEMBERED_PASSWORD_KEY)).not.toContain('plain-secret');
  });

  it('取消勾选会清掉账号与密码，并记住「不勾选」这个状态', () => {
    saveRememberLogin('nomi', true, 'secret');
    saveRememberLogin('nomi', false, 'secret');

    expect(localStorage.getItem(REMEMBERED_ACCOUNT_KEY)).toBeNull();
    expect(localStorage.getItem(REMEMBERED_PASSWORD_KEY)).toBeNull();
    expect(readRememberLogin()).toEqual({ remember: false, account: '', password: '' });
  });

  it('兼容老版本只存了账号、没有勾选键和密码键的情况', () => {
    localStorage.setItem(REMEMBERED_ACCOUNT_KEY, 'legacy');
    expect(readRememberLogin()).toEqual({ remember: true, account: 'legacy', password: '' });
  });

  it('被改坏的密码编码回填为空串，不影响账号与勾选状态', () => {
    saveRememberLogin('nomi', true, 'secret');
    localStorage.setItem(REMEMBERED_PASSWORD_KEY, '!!!not-base64!!!');
    expect(readRememberLogin()).toEqual({ remember: true, account: 'nomi', password: '' });
  });
});
