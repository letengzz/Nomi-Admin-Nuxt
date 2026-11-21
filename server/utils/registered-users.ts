/**
 * 演示用账号表：三个内置演示账号 + 本次进程内新注册的账号。
 *
 * 这是 Nitro mock 接口的进程内存储，只为了让「注册 → 用新账号登录」闭环能跑通；
 * 进程重启即清空，也绝不存明文密码到磁盘。生产必须替换为数据库 + 密码哈希 +
 * 唯一索引，并把 DEMO_ACCOUNTS 整段删掉。
 */
export const DEMO_ACCOUNTS: Record<string, string> = {
  super: '123456',
  admin: '123456',
  user: '123456',
};

export interface RegisteredUser {
  userName: string;
  password: string;
  policyVersion: string;
  agreedAt: string;
}

const registered = new Map<string, RegisteredUser>();

export function isUserNameTaken(userName: string): boolean {
  return hasUser(userName);
}

export function saveRegisteredUser(user: RegisteredUser): void {
  registered.set(user.userName, user);
}

/** 登录时把演示账号与新注册账号放在同一条查凭证路径上。 */
export function resolvePassword(userName: string): string | undefined {
  const demo = DEMO_ACCOUNTS[userName];
  if (demo) return demo;
  return registered.get(userName)?.password;
}

/** 账号是否存在。重置密码时先确认目标账号，避免给不存在的账号写一条新密码。 */
export function hasUser(userName: string): boolean {
  return Object.hasOwn(DEMO_ACCOUNTS, userName) || registered.has(userName);
}

/**
 * 重置密码。
 *
 * 演示账号直接改内存里的表（进程重启即恢复 123456），新注册账号改 Map 里的记录。
 * 生产环境换成「UPDATE users SET password_hash = ?」并把哈希交给 bcrypt/argon2。
 */
export function updatePassword(userName: string, password: string): void {
  if (Object.hasOwn(DEMO_ACCOUNTS, userName)) {
    DEMO_ACCOUNTS[userName] = password;
    return;
  }

  const existing = registered.get(userName);
  if (!existing) throw new Error(`updatePassword: 账号 ${userName} 不存在，调用方应先 hasUser()`);
  existing.password = password;
}
