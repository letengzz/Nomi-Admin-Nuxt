/**
 * 退出登录：删除这一会话的 access + refresh 两条记录，并记一条登录日志。
 *
 * 前端可能在 token 已过期时点退出（此时接口会返回 409），所以这里用
 * `resolveAdmin` 的结果不重要 —— 只要拿到明文 token 就能删，删不到也无害。
 * 但为了不把「退出」变成免鉴权接口，仍然套 defineAdminHandler（过期会 409，
 * 前端在退出流程里忽略即可）。
 */
import { defineAdminHandler } from '../../utils/auth/handler';
import { ok } from '../../utils/http';
import { recordLoginLog } from '../../utils/auth/admin-log';
import { collectRequestMeta } from '../../utils/auth/request-meta';
import { readRefreshToken, readAccessToken, revokeSession } from '../../utils/auth/token';

export default defineAdminHandler({ log: false }, async (event, context) => {
  const body = await readBody<{ refreshToken?: unknown }>(event).catch(() => null);
  const refreshToken = readRefreshToken(event, body) || undefined;
  await recordLoginLog({
    userId: context.admin.id,
    username: context.admin.username,
    nickname: context.admin.nickname,
    behavior: 'logout',
    status: true,
    meta: await collectRequestMeta(event),
  });
  await revokeSession(readAccessToken(event) || context.token, refreshToken);
  return ok(true);
});
