/**
 * 注册页支撑层单测：校验矩阵、常量一致性、中英文案 key 对齐、API 封装。
 * 全部是纯函数与 JSON，跑在 happy-dom 环境里，不需要拉起 Nuxt 运行时。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  clearRegisterDraft,
  createEmptyDraft,
  PASSWORD_MIN_LENGTH,
  POLICY_VERSION,
  readRegisterDraft,
  REDIRECT_DELAY,
  REGISTER_DRAFT_KEY,
  registerErrorCode,
  saveRegisterDraft,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  validateRegisterField,
  type RegisterDraft,
} from '../app/utils/register';
import { fetchRegister, getErrorMessage } from '../app/services/auth';

const draft = (overrides: Partial<RegisterDraft> = {}): RegisterDraft => ({
  ...createEmptyDraft(),
  ...overrides,
});

function flattenKeys(node: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = `${prefix}${key}`;
    return value && typeof value === 'object'
      ? flattenKeys(value as Record<string, unknown>, `${path}.`)
      : [path];
  });
}

function readLocale(name: string): Record<string, unknown> {
  // Vitest 会重写 import.meta.url，基于它算相对路径会落到磁盘根目录；用工作目录更稳。
  const path = resolve(process.cwd(), 'i18n/locales', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

describe('注册校验矩阵（app/utils/register.ts）', () => {
  it('空表单的四个字段各自给出对应错误 key', () => {
    const empty = draft();
    expect(validateRegisterField('username', empty)?.key).toBe('register.rule.usernameRequired');
    expect(validateRegisterField('password', empty)?.key).toBe('register.rule.passwordRequired');
    expect(validateRegisterField('confirmPassword', empty)?.key).toBe(
      'register.rule.confirmPasswordRequired',
    );
    expect(validateRegisterField('agreement', empty)?.key).toBe('register.rule.agreementRequired');
  });

  it('账号长度越界时报长度错误，并带上插值参数', () => {
    expect(validateRegisterField('username', draft({ username: 'ab' }))).toEqual({
      key: 'register.rule.usernameLength',
      params: { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH },
    });
    expect(validateRegisterField('username', draft({ username: 'a'.repeat(21) }))?.key).toBe(
      'register.rule.usernameLength',
    );
    expect(validateRegisterField('username', draft({ username: 'abc' }))).toBeNull();
    expect(validateRegisterField('username', draft({ username: 'a'.repeat(20) }))).toBeNull();
  });

  it('密码少于 6 位报长度错误，且不被 trim 静默改写', () => {
    expect(validateRegisterField('password', draft({ password: '12345' }))).toEqual({
      key: 'register.rule.passwordLength',
      params: { min: PASSWORD_MIN_LENGTH },
    });
    expect(validateRegisterField('password', draft({ password: ' 123456 ' }))).toBeNull();
  });

  it('确认密码做跨字段一致性校验', () => {
    expect(
      validateRegisterField(
        'confirmPassword',
        draft({ password: 'abc123', confirmPassword: 'abc123' }),
      ),
    ).toBeNull();
    expect(
      validateRegisterField(
        'confirmPassword',
        draft({ password: 'abc123', confirmPassword: 'abc124' }),
      )?.key,
    ).toBe('register.rule.passwordMismatch');
  });

  it('改主密码后确认密码立刻变成不一致', () => {
    const filled = draft({ password: 'abc123', confirmPassword: 'abc123', agreement: true });
    expect(validateRegisterField('confirmPassword', filled)).toBeNull();
    filled.password = 'changed';
    expect(validateRegisterField('confirmPassword', filled)?.key).toBe(
      'register.rule.passwordMismatch',
    );
  });

  it('协议勾选后合法表单四个字段全部通过', () => {
    const valid = draft({
      username: 'nomi-user',
      password: 'abc123',
      confirmPassword: 'abc123',
      agreement: true,
    });
    for (const field of ['username', 'password', 'confirmPassword', 'agreement'] as const) {
      expect(validateRegisterField(field, valid)).toBeNull();
    }
  });

  it('常量与服务端复核口径一致', () => {
    expect([USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH, PASSWORD_MIN_LENGTH]).toEqual([3, 20, 6]);
    expect(REDIRECT_DELAY).toBe(1000);
    expect(POLICY_VERSION).toBe('1.0');
  });
});

describe('接口异常码提取', () => {
  it('兼容 FetchError 嵌套 data、业务外壳与裸 statusCode', () => {
    expect(registerErrorCode({ statusCode: 409, data: { data: { code: 409 } } })).toBe(409);
    expect(registerErrorCode({ data: { code: 409 } })).toBe(409);
    expect(registerErrorCode({ statusCode: 500 })).toBe(500);
    expect(registerErrorCode(null)).toBeUndefined();
  });
});

describe('切语言草稿', () => {
  it('只保存账号与协议勾选，绝不把密码落盘', () => {
    sessionStorage.clear();
    saveRegisterDraft({ username: 'draft-user', agreement: true });
    const raw = sessionStorage.getItem(REGISTER_DRAFT_KEY) ?? '';
    expect(raw).toContain('draft-user');
    expect(raw).not.toContain('password');
    expect(readRegisterDraft()).toEqual({ username: 'draft-user', agreement: true });
  });

  it('草稿可清空，损坏数据不会抛错', () => {
    clearRegisterDraft();
    expect(readRegisterDraft()).toBeNull();
    sessionStorage.setItem(REGISTER_DRAFT_KEY, '{broken');
    expect(readRegisterDraft()).toBeNull();
    sessionStorage.clear();
  });
});

describe('中英注册文案', () => {
  const zh = readLocale('zh');
  const en = readLocale('en');

  it('两份 register 段的 key 完全对齐', () => {
    const zhKeys = flattenKeys(zh.register as Record<string, unknown>).sort();
    const enKeys = flattenKeys(en.register as Record<string, unknown>).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it('校验矩阵用到的每个 key 都存在', () => {
    const keys = new Set(flattenKeys(zh.register as Record<string, unknown>, 'register.'));
    const used = [
      'register.rule.usernameRequired',
      'register.rule.passwordRequired',
      'register.rule.confirmPasswordRequired',
      'register.rule.passwordMismatch',
      'register.rule.usernameLength',
      'register.rule.passwordLength',
      'register.rule.agreementRequired',
      'register.success',
      'register.failed',
      'register.conflict',
      'register.policyVersion',
    ];
    for (const key of used) expect(keys.has(key)).toBe(true);
  });

  // 介绍页（app/pages/index.vue）已删除，登录页是注册的唯一入口，
  // 所以这里改成守登录页 ↔ 注册页这一对互跳文案，别再对着 home 段断言。
  it('登录页与注册页的互跳入口文案都在', () => {
    expect((zh.login as Record<string, unknown>).register).toBeTruthy();
    expect((en.login as Record<string, unknown>).register).toBeTruthy();
    expect((zh.register as Record<string, unknown>).toLogin).toBeTruthy();
    expect((en.register as Record<string, unknown>).toLogin).toBeTruthy();
  });
});

describe('fetchRegister 封装', () => {
  const payload = {
    userName: 'nomi-user',
    password: 'abc123',
    agreement: true,
    policyVersion: POLICY_VERSION,
    agreedAt: '2026-11-13T00:00:00.000Z',
  };

  it('POST /api/auth/register 并剥离响应外壳', async () => {
    const spy = vi.fn().mockResolvedValue({
      code: 200,
      msg: 'ok',
      data: { userId: 'u-1', userName: 'nomi-user' },
    });
    const result = await fetchRegister(payload, spy as unknown as typeof $fetch);
    expect(spy).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.userName).toBe('nomi-user');
  });

  it('业务码非 200 时抛错', async () => {
    const spy = vi.fn().mockResolvedValue({ code: 409, msg: '已存在', data: null });
    await expect(fetchRegister(payload, spy as unknown as typeof $fetch)).rejects.toThrow('已存在');
  });

  it('兜底文案可按场景替换', () => {
    expect(getErrorMessage(null, '注册失败，请稍后重试')).toBe('注册失败，请稍后重试');
  });
});
