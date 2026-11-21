/**
 * 续期接口（匿名，对应文档 4.7 `Common::refreshToken()`）。
 *
 * 前端收到 409 后调用它，拿一对新 token 重放原请求。
 * 这是整个系统里**唯一的匿名换 token 入口**，所以做了三件事：
 *   · refresh token 轮换：用过即作废，泄露后只能被利用一次；
 *   · 续期前复查账号状态：token 有效但账号被禁用，不能借续期复活；
 *   · 失败一律返回 303（而不是 409），避免前端在续期失败时无限重试。
 */
import { definePublicHandler } from '../../utils/auth/handler';
import { fail, ok } from '../../utils/http';
import { readRefreshToken, rotateByRefreshToken } from '../../utils/auth/token';
import { findAdminById } from '../../utils/auth/session';

export default definePublicHandler(async (event) => {
  const body = await readBody<{ refreshToken?: unknown }>(event).catch(() => null);
  const refreshToken = readRefreshToken(event, body);

  if (!refreshToken) return fail('缺少 refresh token，请重新登录', 303);

  const rotated = await rotateByRefreshToken(refreshToken);
  if (!rotated) return fail('登录状态已失效，请重新登录', 303);

  const admin = await findAdminById(rotated.userId);
  if (!admin || admin.status !== 'enable') {
    return fail('账号已被禁用或不存在，请重新登录', 303);
  }

  return ok(rotated.tokens);
});
