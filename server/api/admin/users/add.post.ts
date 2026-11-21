/** 新增账号。部门可选，角色至少一个（角色是唯一的权限来源）。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ok } from '../../../utils/http';
import { createUser, normalizeUserPayload } from '../../../utils/auth/user-service';

export default defineAdminHandler('system/user/add', async (event, context) => {
  const input = normalizeUserPayload(await readBody(event), {
    requireUsername: true,
    requirePassword: true,
  });
  const id = await createUser(context, input);
  return ok({ id });
});
