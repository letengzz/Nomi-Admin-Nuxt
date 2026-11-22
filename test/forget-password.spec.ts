/**
 * 忘记密码页支撑层单测：校验矩阵、账号打码、中英文案对齐、验证码状态机、接口封装。
 *
 * 全部是纯函数与 JSON，跑在 happy-dom 环境里，不需要拉起 Nuxt 运行时
 * （与 test/register.spec.ts 同一种取舍）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_MAX_LENGTH,
  ACCOUNT_MIN_LENGTH,
  CODE_LENGTH,
  COUNTDOWN_SECONDS,
  createEmptyForgetDraft,
  maskAccount,
  normalizeCode,
  FORGET_PASSWORD_MIN_LENGTH,
  validateForgetField,
  type ForgetPasswordDraft,
} from '../app/utils/forget-password';
import { STRONG_PASSWORD_MIN_LENGTH } from '../server/utils/auth/password';
import { fetchResetPassword, fetchSendResetCode } from '../app/services/auth';
import {
  clearResetCodes,
  generateResetCode,
  getResendCooldownLeft,
  issueResetCode,
  RESET_CODE_COOLDOWN_MS,
  RESET_CODE_LENGTH,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_TTL_MS,
  verifyResetCode,
  consumeResetCode,
  discardResetCode,
} from '../server/utils/reset-codes';

const draft = (overrides: Partial<ForgetPasswordDraft> = {}): ForgetPasswordDraft => ({
  ...createEmptyForgetDraft(),
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
  const file = resolve(process.cwd(), 'i18n/locales', `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

/** 按 a.b.c 取嵌套值，取不到返回 undefined。 */
function lookup(node: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, node);
}

describe('校验矩阵', () => {
  it('空账号 / 空验证码 / 空密码都会命中对应文案键', () => {
    expect(validateForgetField('account', draft())?.key).toBe('forgetPassword.rule.accountRequired');
    expect(validateForgetField('code', draft())?.key).toBe('forgetPassword.rule.codeRequired');
    expect(validateForgetField('newPassword', draft())?.key).toBe(
      'forgetPassword.rule.newPasswordRequired',
    );
    expect(validateForgetField('confirmPassword', draft())?.key).toBe(
      'forgetPassword.rule.confirmRequired',
    );
  });

  it('账号长度边界与服务端同一组常量', () => {
    expect(ACCOUNT_MIN_LENGTH).toBe(3);
    const short = validateForgetField('account', draft({ account: 'ab' }));
    expect(short?.key).toBe('forgetPassword.rule.accountLength');
    expect(short?.params).toEqual({ min: ACCOUNT_MIN_LENGTH, max: ACCOUNT_MAX_LENGTH });

    // 上限按邮箱长度放宽到 100（对齐 user.email 的 varchar(100)）
    expect(ACCOUNT_MAX_LENGTH).toBe(100);
    const longEmail = `${'a'.repeat(ACCOUNT_MAX_LENGTH - '@nomi.dev'.length)}@nomi.dev`;
    expect(longEmail).toHaveLength(ACCOUNT_MAX_LENGTH);
    expect(validateForgetField('account', draft({ account: longEmail }))).toBeNull();
    expect(
      validateForgetField('account', draft({ account: 'a'.repeat(ACCOUNT_MAX_LENGTH + 1) })),
    ).not.toBeNull();
  });

  it('账号可以是登录名，也可以是绑定邮箱', () => {
    expect(validateForgetField('account', draft({ account: 'super' }))).toBeNull();
    expect(validateForgetField('account', draft({ account: '2020885569@qq.com' }))).toBeNull();
    // 既不是合法登录名、也不是合法邮箱：给出明确文案，而不是含糊的「长度不对」
    expect(validateForgetField('account', draft({ account: 'a'.repeat(30) }))?.key).toBe(
      'forgetPassword.rule.accountFormat',
    );
    expect(validateForgetField('account', draft({ account: 'not an email' }))?.key).toBe(
      'forgetPassword.rule.accountFormat',
    );
  });

  it('账号两端的空白不影响校验', () => {
    expect(validateForgetField('account', draft({ account: '  super  ' }))).toBeNull();
  });

  it('验证码必须是 6 位数字', () => {
    expect(validateForgetField('code', draft({ code: '123456' }))).toBeNull();
    expect(validateForgetField('code', draft({ code: '12345' }))?.key).toBe(
      'forgetPassword.rule.codeFormat',
    );
    expect(validateForgetField('code', draft({ code: '12345a' }))?.key).toBe(
      'forgetPassword.rule.codeFormat',
    );
    // 粘贴带空格的一串数字应该能过（normalizeCode 会剔掉空白）
    expect(validateForgetField('code', draft({ code: ' 123 456 ' }))).toBeNull();
    expect(normalizeCode(' 12 3 456 ')).toBe('123456');
  });

  it('新密码底线与「个人中心改密」的强策略一致，不再沿用注册页的 6 位', () => {
    expect(FORGET_PASSWORD_MIN_LENGTH).toBe(STRONG_PASSWORD_MIN_LENGTH);
    expect(
      validateForgetField('newPassword', draft({ newPassword: 'Abc123!@#' }))?.key,
    ).toBe('forgetPassword.rule.passwordLength');
    expect(validateForgetField('newPassword', draft({ newPassword: 'Abc123!@#x' }))).toBeNull();
  });

  it('字符类别不足三类时拦下', () => {
    // 12 位纯小写：长度够，但只有一类字符
    expect(
      validateForgetField('newPassword', draft({ newPassword: 'abcdefghijkl' }))?.key,
    ).toBe('forgetPassword.rule.passwordWeak');
    // 三类即可（这里是小写 + 数字 + 符号）
    expect(validateForgetField('newPassword', draft({ newPassword: 'abcdefgh12!@' }))).toBeNull();
  });

  it('确认密码与主密码联动', () => {
    const base = draft({ newPassword: 'abc123' });
    expect(validateForgetField('confirmPassword', base)?.key).toBe(
      'forgetPassword.rule.confirmRequired',
    );
    expect(
      validateForgetField('confirmPassword', { ...base, confirmPassword: 'abc124' })?.key,
    ).toBe('forgetPassword.rule.passwordMismatch');
    expect(validateForgetField('confirmPassword', { ...base, confirmPassword: 'abc123' })).toBeNull();
  });
});

describe('账号打码', () => {
  it('邮箱只留首字母与域名', () => {
    expect(maskAccount('user@example.com')).toBe('u***@example.com');
  });

  it('手机号留前三后四', () => {
    expect(maskAccount('13800138000')).toBe('138****8000');
  });

  it('短账号按长度递减打码，绝不原样返回', () => {
    expect(maskAccount('a')).toBe('a*');
    expect(maskAccount('ab')).toBe('a*');
    expect(maskAccount('abcd')).toBe('a**d');
    expect(maskAccount('super')).toBe('su***er');
    expect(maskAccount('   ')).toBe('');
  });
});

describe('国际化', () => {
  const zh = readLocale('zh');
  const en = readLocale('en');

  it('中英文 forgetPassword 段的 key 完全对齐', () => {
    const zhKeys = flattenKeys(zh.forgetPassword as Record<string, unknown>);
    const enKeys = flattenKeys(en.forgetPassword as Record<string, unknown>);
    expect(zhKeys.sort()).toEqual(enKeys.sort());
    expect(zhKeys.length).toBeGreaterThanOrEqual(25);
  });

  it('插值占位符两侧一致', () => {
    const placeholders = (node: Record<string, unknown>, key: string): string[] => {
      const value = lookup(node, key);
      return typeof value === 'string' ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '') : [];
    };
    const zhKeys = flattenKeys(zh.forgetPassword as Record<string, unknown>);
    for (const key of zhKeys) {
      const path = `forgetPassword.${key}`;
      expect(placeholders(en, path).sort(), path).toEqual(placeholders(zh, path).sort());
    }
  });

  it('账号未找到 / 邮箱未绑定 / 邮箱未匹配用户三种提示在两种语言里都存在', () => {
    for (const key of ['accountNotFound', 'emailNotFound', 'emailNotBound']) {
      expect(typeof lookup(zh, `forgetPassword.${key}`), `zh.${key}`).toBe('string');
      expect(typeof lookup(en, `forgetPassword.${key}`), `en.${key}`).toBe('string');
    }
  });

  it('校验矩阵返回的每个文案键在两种语言里都存在', () => {
    const keys = [
      validateForgetField('account', draft())?.key,
      validateForgetField('account', draft({ account: 'ab' }))?.key,
      validateForgetField('code', draft())?.key,
      validateForgetField('code', draft({ code: 'abc' }))?.key,
      validateForgetField('newPassword', draft())?.key,
      validateForgetField('newPassword', draft({ newPassword: '1' }))?.key,
      validateForgetField('confirmPassword', draft())?.key,
      validateForgetField('confirmPassword', draft({ newPassword: 'x', confirmPassword: 'y' }))?.key,
    ].filter((key): key is string => typeof key === 'string');

    expect(keys).toHaveLength(8);
    for (const key of keys) {
      expect(typeof lookup(zh, key), `zh.${key}`).toBe('string');
      expect(typeof lookup(en, key), `en.${key}`).toBe('string');
    }
  });
});

describe('常量一致性（前端 ↔ 服务端）', () => {
  it('验证码位数一致', () => {
    expect(CODE_LENGTH).toBe(RESET_CODE_LENGTH);
  });

  it('倒计时与服务端节流同一个口径', () => {
    expect(COUNTDOWN_SECONDS * 1000).toBe(RESET_CODE_COOLDOWN_MS);
  });

  it('生成的验证码永远是 6 位数字', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateResetCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('验证码状态机', () => {
  const account = 'super';
  const now = 1_700_000_000_000;

  beforeEach(() => {
    clearResetCodes();
  });

  it('未发送过验证码时状态是 missing', () => {
    expect(verifyResetCode(account, '000000', now)).toBe('missing');
  });

  it('正确的验证码校验通过，且 consume 之后立即失效', () => {
    const state = issueResetCode(account, now);
    expect(verifyResetCode(account, state.code, now)).toBe('ok');
    expect(verifyResetCode(account, state.code, now)).toBe('ok');

    expect(consumeResetCode(account, state.code, now)).toBe('ok');
    expect(verifyResetCode(account, state.code, now)).toBe('missing');
  });

  it('错误验证码计次，超过上限后整条记录作废', () => {
    issueResetCode(account, now);
    for (let i = 1; i < RESET_CODE_MAX_ATTEMPTS; i += 1) {
      expect(verifyResetCode(account, 'xxxxxx', now)).toBe('mismatch');
    }
    expect(verifyResetCode(account, 'xxxxxx', now)).toBe('mismatch');
    // 第 5 次失败时记录已被删除，后续校验只剩 missing
    expect(verifyResetCode(account, 'xxxxxx', now)).toBe('missing');
  });

  it('过期后无法使用，且状态为 expired', () => {
    const state = issueResetCode(account, now);
    expect(verifyResetCode(account, state.code, now + RESET_CODE_TTL_MS - 1)).toBe('ok');
    expect(verifyResetCode(account, state.code, now + RESET_CODE_TTL_MS + 1)).toBe('expired');
  });

  it('重新发送会覆盖旧码，旧码立即失效', () => {
    const first = issueResetCode(account, now);
    const second = issueResetCode(account, now + RESET_CODE_COOLDOWN_MS);
    expect(second.code).not.toBe(first.code);
    expect(verifyResetCode(account, first.code, now + RESET_CODE_COOLDOWN_MS)).toBe('mismatch');
    expect(verifyResetCode(account, second.code, now + RESET_CODE_COOLDOWN_MS)).toBe('ok');
  });

  it('冷却期内返回剩余毫秒数，冷却结束归零', () => {
    issueResetCode(account, now);
    expect(getResendCooldownLeft(account, now)).toBe(RESET_CODE_COOLDOWN_MS);
    expect(getResendCooldownLeft(account, now + 30_000)).toBe(RESET_CODE_COOLDOWN_MS - 30_000);
    expect(getResendCooldownLeft(account, now + RESET_CODE_COOLDOWN_MS)).toBe(0);
    expect(getResendCooldownLeft('nobody', now)).toBe(0);
  });
  it('作废后立即失效（发信失败时用）', () => {
    const state = issueResetCode(account, now);
    discardResetCode(account);
    expect(verifyResetCode(account, state.code, now)).toBe('missing');
  });
});

describe('接口封装', () => {
  type ResetCodeRequest = NonNullable<Parameters<typeof fetchSendResetCode>[1]>;

  const okRequest = (data: unknown): ResetCodeRequest =>
    (async () => ({ code: 200, msg: 'ok', data })) as unknown as ResetCodeRequest;

  it('fetchSendResetCode 剥掉响应外壳，只保留投递去向（响应里没有验证码）', async () => {
    const result = await fetchSendResetCode(
      { account: 'super' },
      okRequest({ expiresIn: 300, cooldown: 60, delivery: 'email' }),
    );
    expect(result).toEqual({ expiresIn: 300, cooldown: 60, delivery: 'email' });
    // 兜底：万一服务端将来又把码塞回来，前端也不该把它读出来
    const leaked = await fetchSendResetCode(
      { account: 'super' },
      okRequest({ expiresIn: 300, cooldown: 60, delivery: 'email', code: '123456' }),
    );
    expect(leaked).not.toHaveProperty('code');
  });

  it('未知的 delivery 值按 email 处理（宁可不显示提示，也不暴露内部状态）', async () => {
    const result = await fetchSendResetCode({ account: 'super' }, okRequest({ delivery: 'sms' }));
    expect(result.delivery).toBe('email');
  });

  it('fetchSendResetCode 对缺字段的响应给兜底值', async () => {
    const result = await fetchSendResetCode({ account: 'super' }, okRequest({}));
    expect(result.expiresIn).toBe(300);
    expect(result.cooldown).toBe(60);
  });

  it('业务码非 200 时抛错', async () => {
    const request = (async () => ({
      code: 500,
      msg: '验证码发送失败',
      data: null,
    })) as unknown as ResetCodeRequest;
    await expect(fetchSendResetCode({ account: 'super' }, request)).rejects.toThrow(
      '验证码发送失败',
    );
  });

  it('fetchResetPassword 成功返回账号名', async () => {
    const request = (async () => ({
      code: 200,
      msg: 'ok',
      data: { userName: 'super' },
    })) as unknown as NonNullable<Parameters<typeof fetchResetPassword>[1]>;
    await expect(
      fetchResetPassword({ account: 'super', code: '123456', newPassword: '123456' }, request),
    ).resolves.toEqual({ userName: 'super' });
  });

  it('fetchResetPassword 缺 data 时抛错', async () => {
    const request = (async () => ({
      code: 200,
      msg: '',
      data: null,
    })) as unknown as NonNullable<Parameters<typeof fetchResetPassword>[1]>;
    await expect(
      fetchResetPassword({ account: 'super', code: '123456', newPassword: '123456' }, request),
    ).rejects.toThrow('密码重置失败');
  });
});
