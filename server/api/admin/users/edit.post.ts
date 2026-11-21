/** 编辑账号。密码留空表示不改；改密码或改成禁用都会把该账号的登录态踢掉。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { normalizeUserPayload, updateUser } from '../../../utils/auth/user-service';

export default defineAdminHandler('system/user/edit', async (event, context) => {
  const body = (await readBody(event)) as { id?: unknown } | undefined;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少账号 id');

  const input = normalizeUserPayload(body, { requireUsername: false, requirePassword: false });
  await updateUser(context, id, input);
  return ok({ id });
});
