/**
 * 通知中心详情：铃铛里点某条公告的标题进来看正文。
 *
 * 不挂权限节点 —— 和列表 `/api/notices` 一致，任何已登录账号都能读发给自己的公告；
 * 但「哪一条算发给自己」由 visibleNoticeById 按登录上下文判定（已发布 + 启用 + 范围内）。
 * 越权 / 定时中 / 已停发统一回「公告不存在」，不泄漏记录是否存在。
 */
import { defineAdminHandler } from '../../utils/auth/handler';
import { ApiError } from '../../utils/http';
import { visibleNoticeById } from '../../utils/notice-service';

export default defineAdminHandler({ log: false }, async (_event, context) => {
  const raw = getRouterParam(_event, 'id');
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) throw new ApiError('公告 id 不正确');

  const notice = await visibleNoticeById(context, id);
  if (!notice) throw new ApiError('公告不存在');
  return notice;
});
