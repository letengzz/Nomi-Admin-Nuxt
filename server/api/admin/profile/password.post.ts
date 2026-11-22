/**
 * 改自己的登录密码。
 *
 * 成功后清掉**其他**会话：密码泄露时只换密码不清登录态等于没换。
 * 当前会话保留（用户正在这个浏览器里操作），见 revokeOtherSessions。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { changeSelfPassword, revokeOtherSessions } from '../../../utils/auth/profile-service';
import { ok } from '../../../utils/http';

// 必须放行「改密」本身：这是账号解除 428 限制的唯一出口。
export default defineAdminHandler(
  { log: 'layout.profile.security', bypassPasswordChange: true },
  async (event, context) => {
    const body = (await readBody(event)) as Record<string, unknown> | undefined;
    await changeSelfPassword(context.admin.id, {
      oldPassword: body?.oldPassword,
      newPassword: body?.newPassword,
    });
    await revokeOtherSessions(context.admin.id, context.token);
    return ok(true);
  },
);
