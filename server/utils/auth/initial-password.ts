/**
 * 初始超级管理员的密码来源。
 *
 * ★ 核心约束：**源码里不再出现任何口令字面量**。
 *
 * 之前种子数据里写死 `super / 123456`，并且 README 与设计文档把它公开，
 * 于是每一套新上线的实例都自带一个「权限为 `*`、口令写在 GitHub 上」的超管。
 * 这里把口令从「代码常量」变成「部署参数」或「一次性随机值」：
 *
 *   ① 环境变量 `INITIAL_ADMIN_PASSWORD` —— 部署方自己指定，按 16 位强口令校验，
 *      不合格直接启动失败（而不是静默降级成一个弱口令）；
 *   ② 未配置时随机生成 24 位 —— 字符集去掉了 0/O/1/l 这类易混淆字符，
 *      保证四类字符各至少一个，用 crypto.randomInt 取，无模偏。
 *
 * 无论走哪条路，种子创建的账号都带 `must_change_password = 1`：
 * 日志、卷快照、`.env` 里的值都可能被更多人看到，第一次登录就必须换掉。
 *
 * 随机密码的交付方式（首次启动时由 init.ts 打印）：
 *   · 写入 `<cwd>/data/initial-admin-password.txt`，权限 600，改密后自动删除；
 *   · 开发环境同时打印到控制台，省得去翻文件。
 * 生产环境只打印文件路径 —— 容器日志常被集中采集，口令不该出现在里面。
 */
import { randomInt } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkPasswordStrength, INITIAL_PASSWORD_MIN_LENGTH } from './password';

export const INITIAL_ADMIN_USERNAME = 'super';

/** 指定初始口令的环境变量名。配了但不够强 → 启动失败。 */
export const INITIAL_PASSWORD_ENV = 'INITIAL_ADMIN_PASSWORD';

/** 随机口令的文件名（位于 `<cwd>/data/`，该目录已被 .gitignore / .dockerignore 排除）。 */
const INITIAL_PASSWORD_FILE = 'initial-admin-password.txt';

/** 易混淆字符（0/O、1/l/I）全部剔除：这串密码要靠人从终端或文件里抄一遍。 */
const CHARSET_LOWER = 'abcdefghijkmnpqrstuvwxyz';
const CHARSET_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CHARSET_DIGIT = '23456789';
const CHARSET_SYMBOL = '!@#$%^&*()-_=+';
const CHARSET_ALL = CHARSET_LOWER + CHARSET_UPPER + CHARSET_DIGIT + CHARSET_SYMBOL;

/** 默认长度。24 位覆盖四类字符，熵足够高，手抄也不算太长。 */
const GENERATED_LENGTH = 24;

export interface InitialPassword {
  password: string;
  /** env = 部署方指定；generated = 本次启动随机生成 */
  source: 'env' | 'generated';
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)]!;
}

/** 生成强随机口令：四类字符各保证一个，再补齐长度，最后洗牌。 */
export function generateInitialPassword(length = GENERATED_LENGTH): string {
  const size = Math.max(length, INITIAL_PASSWORD_MIN_LENGTH);
  const chars = [
    pick(CHARSET_LOWER),
    pick(CHARSET_UPPER),
    pick(CHARSET_DIGIT),
    pick(CHARSET_SYMBOL),
  ];
  while (chars.length < size) chars.push(pick(CHARSET_ALL));

  // Fisher–Yates：保证上面四个「固定位置」的字符也被打散。
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/**
 * 解析本次启动要用的初始口令。
 *
 * 环境变量配了但不符合强度要求时**抛错**：这里退让一次，整个修复就白做了 ——
 * 部署方会以为「配了变量就安全了」，实际库里躺着 `Admin@123`。
 */
export function resolveInitialAdminPassword(): InitialPassword {
  const fromEnv = process.env[INITIAL_PASSWORD_ENV]?.trim() ?? '';
  if (!fromEnv) return { password: generateInitialPassword(), source: 'generated' };

  const reason = checkPasswordStrength(fromEnv, {
    minLength: INITIAL_PASSWORD_MIN_LENGTH,
    username: INITIAL_ADMIN_USERNAME,
  });
  if (reason) {
    throw new Error(`${INITIAL_PASSWORD_ENV} 不符合初始口令强度要求：${reason}`);
  }
  return { password: fromEnv, source: 'env' };
}

export function initialPasswordFilePath(): string {
  return join(process.cwd(), 'data', INITIAL_PASSWORD_FILE);
}

/**
 * 把随机口令落盘（600）。返回路径；写不进去（只读文件系统、目录无权限）时返回
 * undefined 并告警 —— 调用方会退化成「只打印到控制台」，不能因为写文件失败
 * 就让新装的系统进不去。
 */
export async function persistInitialPassword(password: string): Promise<string | undefined> {
  const filePath = initialPasswordFilePath();
  try {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    await writeFile(filePath, `${password}\n`, { encoding: 'utf8', mode: 0o600 });
    // mode 只在创建时生效；文件已存在时要再 chmod 一次。
    await chmod(filePath, 0o600);
    return filePath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[security] 初始口令写入 ${filePath} 失败：${message}`);
    return undefined;
  }
}

/**
 * 删除初始口令文件。改密成功后调用：这串密码从此没有任何用处，
 * 留在磁盘上只是多一个「能被读到的明文凭据」。
 */
export async function removeInitialPasswordFile(): Promise<void> {
  await rm(initialPasswordFilePath(), { force: true }).catch(() => undefined);
}
