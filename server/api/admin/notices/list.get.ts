/** 通知公告列表（管理端）：支持关键字/分类/状态/发布态筛选，含定时中内容。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { getQuery } from 'h3';
import {
  listNotices,
  normalizeNoticeListQuery,
} from '../../../utils/notice-service';

export default defineAdminHandler('system/notice/index', async (event) => {
  const list = await listNotices(normalizeNoticeListQuery(getQuery(event)));
  return { list, total: list.length };
});
