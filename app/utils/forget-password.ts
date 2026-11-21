/**
 * 忘记密码页的纯逻辑层：常量 + 两步表单的校验矩阵。
 *
 * 与注册页（app/utils/register.ts）同构，收益也相同：
 *   ① 校验规则不依赖 Vue / Element Plus，可以直接单测；
 *   ② 组件只负责把返回的 i18n key 翻成当前语言，切语言时 computed 自动重算；
 *   ③ 账号长度直接复用注册页的常量，服务端也用同一组数值，
 *      不会出现「前端放行、后端拒绝」（docs/忘记密码页设计.md 18.5）。
 */
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from './register';

/** 账号长度边界：与注册页 / 登录页同一个字段，复用同一组常量。 */
export const ACCOUNT_MIN_LENGTH = USERNAME_MIN_LENGTH;
export const ACCOUNT_MAX_LENGTH = USERNAME_MAX_LENGTH;

/** 验证码位数。服务端 server/utils/reset-codes.ts 用同一数值生成。 */
export const CODE_LENGTH = 6;

/** 新密码最短长度，与注册页保持一致。 */
export const FORGET_PASSWORD_MIN_LENGTH = 6;

/** 重发验证码的冷却秒数（前端倒计时 + 服务端节流同一个值）。 */
export const COUNTDOWN_SECONDS = 60;

/** 重置成功后跳转登录页的延迟，和注册页同节奏。 */
export const FORGET_REDIRECT_DELAY = 1000;

export type ForgetStep = 1 | 2;

export interface ForgetPasswordDraft {
  account: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export type ForgetPasswordField = keyof ForgetPasswordDraft;

/** 一条违规：key 是 i18n 文案键，params 供 vue-i18n 插值（如 {min} / {max}）。 */
export interface ForgetPasswordViolation {
  key: string;
  params?: Record<string, number>;
}

export function createEmptyForgetDraft(): ForgetPasswordDraft {
  return { account: '', code: '', newPassword: '', confirmPassword: '' };
}

/** 6 位数字验证码。粘进来的空格先剔掉，避免「看起来填了却校验不过」。 */
export function normalizeCode(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/**
 * 校验单个字段。返回 null 表示通过。
 *
 * 跨字段校验（确认密码）直接读 draft.newPassword，不额外维护状态；
 * 未渲染的字段不会被 ElForm 的 validate() 命中，因此步骤 1 只校验 account 是安全的。
 */
export function validateForgetField(
  field: ForgetPasswordField,
  draft: ForgetPasswordDraft,
): ForgetPasswordViolation | null {
  switch (field) {
    case 'account': {
      const value = draft.account.trim();
      if (!value) return { key: 'forgetPassword.rule.accountRequired' };
      if (value.length < ACCOUNT_MIN_LENGTH || value.length > ACCOUNT_MAX_LENGTH) {
        return {
          key: 'forgetPassword.rule.accountLength',
          params: { min: ACCOUNT_MIN_LENGTH, max: ACCOUNT_MAX_LENGTH },
        };
      }
      return null;
    }
    case 'code': {
      const value = normalizeCode(draft.code);
      if (!value) return { key: 'forgetPassword.rule.codeRequired' };
      if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(value)) {
        return { key: 'forgetPassword.rule.codeFormat', params: { length: CODE_LENGTH } };
      }
      return null;
    }
    case 'newPassword': {
      if (!draft.newPassword) return { key: 'forgetPassword.rule.newPasswordRequired' };
      if (draft.newPassword.length < FORGET_PASSWORD_MIN_LENGTH) {
        return {
          key: 'forgetPassword.rule.passwordLength',
          params: { min: FORGET_PASSWORD_MIN_LENGTH },
        };
      }
      return null;
    }
    case 'confirmPassword': {
      if (!draft.confirmPassword) return { key: 'forgetPassword.rule.confirmRequired' };
      if (draft.confirmPassword !== draft.newPassword) {
        return { key: 'forgetPassword.rule.passwordMismatch' };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * 二次确认文案里展示的账号：邮箱只留首字符与域名（u***@mail.com），
 * 手机号留前三后四（138****8000），其余按长度打码。
 * 目的是让用户能认出「发给谁的」，同时不在屏幕上平铺完整账号。
 */
export function maskAccount(account: string): string {
  const value = account.trim();
  if (!value) return '';

  const at = value.indexOf('@');
  if (at > 0) {
    const name = value.slice(0, at);
    const domain = value.slice(at);
    return name.length <= 1 ? `${name}***${domain}` : `${name.slice(0, 1)}***${domain}`;
  }

  if (/^\d{7,}$/.test(value)) {
    return `${value.slice(0, 3)}****${value.slice(-4)}`;
  }

  if (value.length <= 2) return `${value.slice(0, 1)}*`;
  if (value.length <= 4) return `${value.slice(0, 1)}**${value.slice(-1)}`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
