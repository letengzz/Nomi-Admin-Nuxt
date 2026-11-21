/**
 * 管理端登录。
 *
 * 与旧的 `/api/auth/login` 演示接口的区别：账号来自 `user` 表、密码走 scrypt
 * 校验、失败次数与锁定写库、token 落 `token` 表（只存摘要）。
 *
 * 返回业务码而不是 HTTP 401：前端登录页统一把 `data.msg` 提示出来，
 * 200 + code=0 让「密码错」和「网络错」走两套完全不同的处理路径。
 */
import { definePublicHandler } from '../../utils/auth/handler';
import { ApiError, fail, ok } from '../../utils/http';
import { loginAdmin } from '../../utils/auth/session';

const USERNAME_MAX = 20;

export default definePublicHandler(async (event) => {
  const body = await readBody<{
    userName?: unknown;
    username?: unknown;
    password?: unknown;
    departmentId?: unknown;
    keepLogin?: unknown;
  }>(event);

  const rawName = body?.userName ?? body?.username;
  const username = typeof rawName === 'string' ? rawName.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const departmentId = Number(body?.departmentId) || 0;
  // 默认保持登录：中后台用户更在意「别三天两头让我重登」。
  const keepLogin = body?.keepLogin !== false;

  if (!username || !password) throw new ApiError('请输入账号和密码');
  // 长度越界直接按「账号或密码错误」处理，不暴露「这个账号太长」这种无意义信息。
  if (username.length > USERNAME_MAX) throw new ApiError('账号或密码错误');

  const result = await loginAdmin(event, username, password, { keepLogin, departmentId });
  if (!result.ok) return fail(result.msg, result.code);

  return ok({
    token: result.tokens.token,
    refreshToken: result.tokens.refreshToken,
    expireTime: result.tokens.expireTime,
    refreshExpireTime: result.tokens.refreshExpireTime,
    adminInfo: result.profile,
  });
});
