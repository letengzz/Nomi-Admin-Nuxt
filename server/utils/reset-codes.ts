/**
 * 重置密码验证码表（进程内存储）。
 *
 * 这张表的安全属性比「能不能跑通」重要得多，所以每一条都写清楚为什么：
 *
 *   ① **不存明文验证码**：表里只有 `HMAC-SHA256(账号 + 验证码, 进程随机密钥)`。
 *      内存被 dump、日志被打印、调试器挂上去看到的都只是摘要 —— 拿到摘要也换不出验证码
 *      （10^6 的空间虽然不大，但密钥进程重启即失效，窗口只有 5 分钟）。
 *   ② **比较用 timingSafeEqual**：定长摘要逐字节比较，不给计时侧信道留口子。
 *   ③ **有效期 5 分钟**、**最多试错 5 次**、**同账号 60 秒冷却**：分别挡住「慢速爆破」
 *      「在线枚举」「被当成邮件轰炸机」。
 *   ④ **验证码不兑换任何会话**：本模块只回答「这个码对不对」，签发 token 是登录接口的事。
 *
 * 与旧版的行为差异（安全修复的核心）：
 *   · 旧版由调用方把 `state.code` 直接塞进 HTTP 响应给前端显示，等于任何能打接口的人
 *     都能给自己发码、再用码重置任意账号 —— 现在验证码只经由投递通道（邮件）离开服务端，
 *     函数返回值里的 `code` 仅供**发信那一行**使用。
 *   · 旧版按账号做冷却并直接返回 429，等于告诉攻击者「这个账号存在且刚发过码」；
 *     现在冷却期内不发信但也返回成功，枚举信号消失。
 *
 * 多实例部署注意：进程内 Map 意味着「A 实例发的码 B 实例验不过」。
 * 真要多实例，把这张表换成 Redis（key = reset:code:<账号>，value = 摘要，
 * TTL 300，INCR 计次），下面导出的函数签名可以原样保留。
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 验证码有效期：5 分钟。 */
export const RESET_CODE_TTL_MS = 5 * 60 * 1000;

/** 允许的最大试错次数。6 位数字配合 5 次上限，命中概率约 5/10^6。 */
export const RESET_CODE_MAX_ATTEMPTS = 5;

/** 同一账号两次发送之间的最小间隔。 */
export const RESET_CODE_COOLDOWN_MS = 60 * 1000;

/** 验证码位数：与 app/utils/forget-password.ts 的 CODE_LENGTH 一致，由单测断言。 */
export const RESET_CODE_LENGTH = 6;

/**
 * 摘要密钥。进程启动时随机生成 —— 不做持久化是**故意**的：
 * 重启后所有未用的验证码自然失效，用户重发一次即可，代价远小于「密钥落盘被读走」。
 */
const DIGEST_KEY = randomBytes(32);

export type ResetCodeStatus = 'ok' | 'missing' | 'expired' | 'mismatch' | 'locked';

/** 表里真正存的东西：只有摘要，没有验证码本身。 */
interface StoredResetCode {
  digest: Buffer;
  expiresAt: number;
  attempts: number;
  sentAt: number;
}

/** 刚签发的一条验证码。`code` 只应交给投递通道，**不得**出现在任何 HTTP 响应里。 */
export interface IssuedResetCode {
  account: string;
  code: string;
  expiresAt: number;
  sentAt: number;
}

const codes = new Map<string, StoredResetCode>();

/** 生成 6 位数字验证码。用 crypto.randomInt 而不是 Math.random：后者可预测。 */
export function generateResetCode(): string {
  const max = 10 ** RESET_CODE_LENGTH;
  return String(randomInt(0, max)).padStart(RESET_CODE_LENGTH, '0');
}

/** 摘要 = HMAC(账号 + '\n' + 验证码)。账号参与摘要，防止同一串码在账号之间串用。 */
function digestOf(account: string, code: string): Buffer {
  return createHmac('sha256', DIGEST_KEY).update(`${account}\n${code.trim()}`).digest();
}

/** 定长摘要比较。长度不同直接 false（正常情况下不会发生）。 */
function digestEquals(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** 距离下次可发送还剩多少毫秒，0 表示现在就能发。 */
export function getResendCooldownLeft(account: string, now = Date.now()): number {
  const state = codes.get(account);
  if (!state) return 0;
  return Math.max(0, state.sentAt + RESET_CODE_COOLDOWN_MS - now);
}

/** 签发一条验证码，覆盖该账号之前的记录（旧码立即失效）。 */
export function issueResetCode(account: string, now = Date.now()): IssuedResetCode {
  const code = generateResetCode();
  codes.set(account, {
    digest: digestOf(account, code),
    expiresAt: now + RESET_CODE_TTL_MS,
    attempts: 0,
    sentAt: now,
  });
  return { account, code, expiresAt: now + RESET_CODE_TTL_MS, sentAt: now };
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
  if (!digestEquals(state.digest, digestOf(account, code))) {
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

/** 作废某账号的验证码。发信失败时调用 —— 没送达的码不该留在表里。 */
export function discardResetCode(account: string): void {
  codes.delete(account);
}

/** 仅供单测与本地调试：清空整张表。 */
export function clearResetCodes(): void {
  codes.clear();
}
