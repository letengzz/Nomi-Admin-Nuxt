/**
 * 演示用的重置密码验证码表（进程内存储）。
 *
 * 真实项目里这张表应该落在 Redis：key = 账号，value = 验证码 + 过期时间 + 试错次数，
 * 并且验证码由邮件 / 短信网关投递。这里只保留三件真正重要的事，让演示闭环可跑：
 *
 *   ① **有效期**：验证码 5 分钟过期，过期后必须重新获取；
 *   ② **试错上限**：连续 5 次校验失败即作废，避免 6 位数字被在线枚举；
 *   ③ **发送节流**：同一账号 60 秒内只能发一次，防止被当成短信轰炸机。
 *
 * 另外两条属于「线上必须、演示可省」的规则写在注释里，不实现的理由也写清：
 *   · 账号不存在时同样返回成功（防枚举）——演示环境需要用户能立刻看到验证码，
 *     刻意保留了这个差异，最终由 password-reset 接口的 404 兜住；
 *   · 验证码只能用于重置密码，不能兑换任何会话——本文件不签发 token。
 */
import { randomInt } from 'node:crypto';

/** 验证码有效期：5 分钟。 */
export const RESET_CODE_TTL_MS = 5 * 60 * 1000;

/** 允许的最大试错次数。 */
export const RESET_CODE_MAX_ATTEMPTS = 5;

/** 同一账号两次发送之间的最小间隔。 */
export const RESET_CODE_COOLDOWN_MS = 60 * 1000;

/** 验证码位数：与 app/utils/forget-password.ts 的 CODE_LENGTH 一致，由单测断言。 */
export const RESET_CODE_LENGTH = 6;

export type ResetCodeStatus = 'ok' | 'missing' | 'expired' | 'mismatch' | 'locked';

export interface ResetCodeState {
  account: string;
  code: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
}

const codes = new Map<string, ResetCodeState>();

/** 生成 6 位数字验证码。用 crypto.randomInt 而不是 Math.random：后者可预测。 */
export function generateResetCode(): string {
  const max = 10 ** RESET_CODE_LENGTH;
  return String(randomInt(0, max)).padStart(RESET_CODE_LENGTH, '0');
}

/** 距离下次可发送还剩多少毫秒，0 表示现在就能发。 */
export function getResendCooldownLeft(account: string, now = Date.now()): number {
  const state = codes.get(account);
  if (!state) return 0;
  return Math.max(0, state.sentAt + RESET_CODE_COOLDOWN_MS - now);
}

/** 签发一条验证码，覆盖该账号之前的记录（旧码立即失效）。 */
export function issueResetCode(account: string, now = Date.now()): ResetCodeState {
  const state: ResetCodeState = {
    account,
    code: generateResetCode(),
    expiresAt: now + RESET_CODE_TTL_MS,
    attempts: 0,
    sentAt: now,
  };
  codes.set(account, state);
  return state;
}

/** 只校验不消耗，用于「校验失败要计次、成功后由调用方决定何时删除」。 */
export function verifyResetCode(account: string, code: string, now = Date.now()): ResetCodeStatus {
  const state = codes.get(account);
  if (!state) return 'missing';
  if (state.expiresAt <= now) {
    codes.delete(account);
    return 'expired';
  }
  if (state.attempts >= RESET_CODE_MAX_ATTEMPTS) {
    codes.delete(account);
    return 'locked';
  }
  if (state.code !== code.trim()) {
    state.attempts += 1;
    if (state.attempts >= RESET_CODE_MAX_ATTEMPTS) codes.delete(account);
    return 'mismatch';
  }
  return 'ok';
}

/** 校验并作废：重置密码成功后必须调用，保证同一个码不能用两次。 */
export function consumeResetCode(account: string, code: string, now = Date.now()): ResetCodeStatus {
  const status = verifyResetCode(account, code, now);
  if (status === 'ok') codes.delete(account);
  return status;
}

/** 仅供单测与本地调试：清空整张表。 */
export function clearResetCodes(): void {
  codes.clear();
}
