/** 删除词条：译文一并删除，前端自动回退到内置语言文件。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { deleteEntry } from '../../../utils/auth/language-service';

export default defineAdminHandler('system/language/del', async (event) => {
  const body = await readBody<{ id?: unknown }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少词条 id');
  await deleteEntry(id);
  return ok({ id });
});
