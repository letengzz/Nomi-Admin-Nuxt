/**
 * 管理端按 id 取单条公告，供独立编辑页回填表单。
 * 用编辑权限节点：能看到这条的管理员才有资格编辑它；不存在统一按 404 处理。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError } from '../../../utils/http';
import { getNoticeForAdmin } from '../../../utils/notice-service';

export default defineAdminHandler('system/notice/edit', async (event) => {
  const raw = getRouterParam(event, 'id');
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少公告 id');

  const notice = await getNoticeForAdmin(id);
  if (!notice) throw new ApiError('公告不存在');
  return notice;
});
