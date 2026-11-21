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

/** 密码强度：登录页演示密码 123456 是 6 位，所以下限保持 6，与注册页一致。 */
export const PASSWORD_MIN_LENGTH = 6;
