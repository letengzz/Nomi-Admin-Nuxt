/** 批量启用 / 停用。停用会同时清掉 token，让「禁用」立即生效。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ok } from '../../../utils/http';
import { normalizeUserIds, setUserStatus } from '../../../utils/auth/user-service';

export default defineAdminHandler('system/user/status', async (event, context) => {
  const body = (await readBody(event)) as
    | { id?: unknown; ids?: unknown; status?: unknown }
    | undefined;
  const ids = normalizeUserIds(body?.ids ?? (body?.id === undefined ? [] : [body.id]));
  const status = body?.status === 'disable' ? 'disable' : 'enable';
  const updated = await setUserStatus(context, ids, status);
  return ok({ updated, status });
});
