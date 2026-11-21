/** 删除语言：连同它的全部译文一起删，词条本身保留。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { deleteLanguage } from '../../../utils/auth/language-service';

export default defineAdminHandler('system/language/del', async (event) => {
  const body = await readBody<{ id?: unknown }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少语言 id');
  await deleteLanguage(id);
  return ok({ id });
});
