/** 删除通知公告。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { deleteNotice } from '../../../utils/notice-service';

export default defineAdminHandler('system/notice/del', async (event) => {
  const body = await readBody<{ id?: unknown }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少公告 id');
  await deleteNotice(id);
  return ok({ id });
});
