/**
 * 密码哈希。不引入 bcrypt 依赖：Node 内置的 scrypt 同样是内存硬（memory-hard）
 * 算法，参数按 OWASP 建议的 N=16384 / r=8 / p=1 取，哈希串自带参数，未来调参
 * 不影响老密码校验。
 *
 * 存储格式：`scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>`
 * —— 把参数写进哈希串，而不是写死在代码里，否则改一次参数所有老密码都验不过。
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
/** scrypt 的 N 必须是 2 的幂；超过 2^20 会让单次校验变成秒级，明确拒绝。 */
const MAX_N = 1 << 20;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p } = DEFAULT_PARAMS;
  const hash = await scryptAsync(password, salt, KEY_LENGTH, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * 校验密码。任何格式问题都返回 false 而不是抛错 —— 一个损坏的哈希串
 * 应该等于「这个密码不对」，不应该让登录接口 500。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    // 兼容历史字段：早期演示版本存的是明文。命中后由调用方提示改密。
    return stored === password;
  }

  const N = Number.parseInt(parts[1] ?? '', 10);
  const r = Number.parseInt(parts[2] ?? '', 10);
  const p = Number.parseInt(parts[3] ?? '', 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (N <= 1 || N > MAX_N || (N & (N - 1)) !== 0 || r <= 0 || p <= 0) return false;

  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scryptAsync(password, salt, expected.length, { N, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * 历史下限：6 位。保留给「导入文件里已有的弱口令」这类**兼容性校验**，
 * 新设置的密码一律走下面的 `STRONG_PASSWORD_MIN_LENGTH`。
 */
export const PASSWORD_MIN_LENGTH = 6;

/** 新密码下限。低于这个长度的口令在现代 GPU 面前基本等于没有。 */
export const STRONG_PASSWORD_MIN_LENGTH = 10;

/** 私钥式强口令的下限：初始管理员密码由机器生成，可以要求得更严。 */
export const INITIAL_PASSWORD_MIN_LENGTH = 16;

/** 四类字符：小写 / 大写 / 数字 / 符号。 */
const PASSWORD_CLASS_PATTERNS = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/] as const;

/**
 * 常见弱口令黑名单。
 *
 * 不做完整字典（那要塞几十万条，还得随包发布），只挡住「猜第一下就会试」的那批。
 * 真正的防线是长度与字符类别，这里只负责把明显不该通过的值挡在门外。
 */
const COMMON_PASSWORDS = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '111111',
  '000000',
  'abc123',
  'abc123456',
  'admin',
  'admin123',
  'admin888',
  'iloveyou',
  'letmein',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwerty',
  'qwerty123',
  'welcome',
  'welcome123',
  '1qaz2wsx',
  '1q2w3e4r',
  'nomi123456',
]);

export interface PasswordPolicyOptions {
  /** 覆盖下限；初始管理员密码传 INITIAL_PASSWORD_MIN_LENGTH */
  minLength?: number;
  /** 账号名。密码里包含账号名时直接拒绝（admin / admin2026 这类） */
  username?: string;
}

/**
 * 校验**新设置**的密码强度，返回拒绝原因；通过时返回 null。
 *
 * 返回原因而不是直接抛错：初始密码的来源是环境变量，调用方需要把
 * 「哪个变量配错了、错在哪」原样写进启动日志，而不是一句笼统的失败。
 */
export function checkPasswordStrength(
  password: string,
  options: PasswordPolicyOptions = {},
): string | null {
  const minLength = options.minLength ?? STRONG_PASSWORD_MIN_LENGTH;

  if (password.length < minLength) return `至少需要 ${minLength} 位`;
  if (password.length > 128) return '不能超过 128 位';

  const classes = PASSWORD_CLASS_PATTERNS.filter((pattern) => pattern.test(password)).length;
  if (classes < 3) return '需包含小写字母、大写字母、数字、符号中的至少三类';

  // 同一字符重复（aaaaaaaaaa）在字符类别上能凑出两类，但没有任何强度。
  if (/^(.)\1+$/.test(password)) return '不能是同一个字符的重复';

  const normalized = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) return '属于常见弱口令';

  const username = options.username?.trim().toLowerCase();
  if (username && username.length >= 3 && normalized.includes(username)) return '不能包含账号名';

  return null;
}
