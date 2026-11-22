/**
 * 导出账号。
 *
 * 筛选条件与列表完全一致（同一套 where），所以「屏幕上看到什么，导出的就是什么」。
 * 返回 base64 而不是二进制流：管理端所有接口共用同一个 `{ code, msg, data }` 信封，
 * 二进制流会让这一个接口变成特例 —— 前端要分两条解析路径，错误也没法统一提示。
 * 账号量级（几千行）下 base64 的额外开销可以忽略。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import {
  listUsersForExport,
  normalizeUserListQuery,
} from '../../../utils/auth/user-service';
import { buildUserExportFile, timestampedFileName } from '../../../utils/auth/user-import';

export default defineAdminHandler('system/user/index', async (event, context) => {
  const query = normalizeUserListQuery(getQuery(event));
  const { rows, total, truncated } = await listUsersForExport(context, query);
  // 空表也生成一个只剩表头的文件没有意义，直接说清楚为什么点不动。
  if (rows.length === 0) throw new ApiError('没有符合当前筛选条件的账号可导出');

  return ok({
    fileName: timestampedFileName('users'),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: buildUserExportFile(rows).toString('base64'),
    total,
    truncated,
  });
});
