/** 新增通知公告。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { addNotice, normalizeNoticeInput } from '../../../utils/notice-service';

export default defineAdminHandler('system/notice/add', async (event, context) => {
  const input = normalizeNoticeInput(await readBody(event));
  const result = await addNotice(input, context);
  if (!result.id) throw new ApiError('创建公告失败');
  return ok(result);
});
