import { randomUUID } from 'node:crypto';

/**
 * 演示登录接口。仅用于模板，生产必须替换为真实鉴权（数据库校验 + 密码哈希 + 会话/Cookie）。
 * 与前端 app/constants/auth.ts 的演示账号保持一致。
 */
const DEMO_ACCOUNTS: Record<string, string> = {
  super: '123456',
  admin: '123456',
  user: '123456',
};

export default defineEventHandler(async (event) => {
  const body = await readBody<{ userName?: unknown; password?: unknown }>(event);
  const userName = typeof body?.userName === 'string' ? body.userName.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const expected = Object.hasOwn(DEMO_ACCOUNTS, userName) ? DEMO_ACCOUNTS[userName] : undefined;

  if (!expected || password !== expected) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid credentials',
      data: { code: 401, msg: '账号或密码错误，请检查后重试' },
    });
  }

  return {
    code: 200,
    msg: 'ok',
    data: {
      token: randomUUID(),
      refreshToken: randomUUID(),
      role: `R_${userName.toUpperCase()}`,
      userName,
    },
  };
});
