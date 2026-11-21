/**
 * 当前账号可见的通知公告（铃铛抽屉用）。
 *
 * 只返回「已发布 + 状态启用 + 在通知范围内」的公告；范围由服务端按登录上下文
 * 推导，前端无法越权。不挂权限节点：任何已登录账号都该看到发给自己的公告。
 */
import { defineAdminHandler } from '../utils/auth/handler';
import { visibleNoticesFor } from '../utils/notice-service';

export default defineAdminHandler({ log: false }, async (_event, context) => {
  const list = await visibleNoticesFor(context);
  return { list, total: list.length };
});
