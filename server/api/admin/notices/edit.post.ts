/** 编辑通知公告。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { getNoticeRow, normalizeNoticeInput, updateNotice } from '../../../utils/notice-service';

export default defineAdminHandler('system/notice/edit', async (event) => {
  const body = await readBody<{ id?: unknown }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少公告 id');
  if (!await getNoticeRow(id)) throw new ApiError('公告不存在');

  const input = normalizeNoticeInput(body);
  await updateNotice(id, input);
  return ok({ id });
});
