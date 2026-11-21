/** 重置账号密码。看不到原密码，只能覆盖成新密码并让旧登录态失效。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { resetUserPassword } from '../../../utils/auth/user-service';

export default defineAdminHandler('system/user/resetPwd', async (event, context) => {
  const body = (await readBody(event)) as { id?: unknown; password?: unknown } | undefined;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少账号 id');
  const password = typeof body?.password === 'string' ? body.password : '';
  await resetUserPassword(context, id, password);
  return ok({ id });
});
