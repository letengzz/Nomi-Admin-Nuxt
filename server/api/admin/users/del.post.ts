/** 删除账号，支持单个与批量（`ids` 优先）。不能删自己、不能删最后一个超管。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ok } from '../../../utils/http';
import { deleteUsers, normalizeUserIds } from '../../../utils/auth/user-service';

export default defineAdminHandler('system/user/del', async (event, context) => {
  const body = (await readBody(event)) as { id?: unknown; ids?: unknown } | undefined;
  const ids = normalizeUserIds(body?.ids ?? (body?.id === undefined ? [] : [body.id]));
  const deleted = await deleteUsers(context, ids);
  return ok({ deleted });
});
