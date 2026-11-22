/**
 * 登录接口（兼容壳）。
 *
 * 登录页调用的是 `/api/auth/login`，返回外壳是 `{code:200,data:{token,refreshToken,role,userName}}`。
 * 这个文件保留那层壳，把真正的鉴权交给数据库：账号来自 `user` 表，密码 scrypt 校验，
 * 失败次数/锁定写库，token 存 `token` 表。新代码请直接用 `/api/admin/login`。
 */
import { definePublicHandler } from '../../utils/auth/handler';
import { ApiError } from '../../utils/http';
import { loginAdmin } from '../../utils/auth/session';
import { getAdminRoles } from '../../utils/auth/rbac';

export default definePublicHandler(async (event) => {
  const body = await readBody<{
    userName?: unknown;
    password?: unknown;
    departmentId?: unknown;
    keepLogin?: unknown;
  }>(event);
  const userName = typeof body?.userName === 'string' ? body.userName.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const departmentId = Number(body?.departmentId) || 0;

  if (!userName || !password) throw new ApiError('请输入账号和密码');

  const result = await loginAdmin(event, userName, password, {
    keepLogin: body?.keepLogin !== false,
    departmentId,
  });
  if (!result.ok) throw new ApiError(result.msg, result.code);

  // role 只是给旧前端展示用的标签：取第一个角色名，没有则回退到 R_USER。
  const roles = await getAdminRoles(result.profile.id);
  const role = roles[0]?.name ?? 'R_USER';

  return {
    code: 200,
    msg: 'ok',
    data: {
      token: result.tokens.token,
      refreshToken: result.tokens.refreshToken,
      expireTime: result.tokens.expireTime,
      role,
      userName: result.profile.username,
      // 前端据此把用户直接带到「改密」页，而不是进后台再被一堆 428 拦住。
      mustChangePassword: result.profile.mustChangePassword,
    },
  };
});
