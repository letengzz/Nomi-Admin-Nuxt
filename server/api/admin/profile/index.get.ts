/**
 * 当前登录账号的完整资料（个人中心用）。
 *
 * 只读自己的账号：id 从 token 推导，接口不收任何参数 —— 传别人的 id 进来也没有
 * 可以塞进 SQL 的位置。因此这里不挂权限节点：有登录态就该能看自己的资料。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { getSelfProfile } from '../../../utils/auth/profile-service';
import { ok } from '../../../utils/http';

export default defineAdminHandler({ log: false, bypassPasswordChange: true }, async (_event, context) => {
  return ok(await getSelfProfile(context.admin.id));
});
