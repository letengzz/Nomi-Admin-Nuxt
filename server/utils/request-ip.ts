/**
 * 取请求来源 IP。
 *
 * 与 `server/utils/auth/session.ts` 里的私有实现保持同一口径：优先取
 * `x-forwarded-for` 的第一段（最靠近客户端的那个代理写的），没有就退回 socket 地址。
 *
 * 安全前提：只有在**可信反向代理**（本仓库的 deploy/nginx.conf）后面部署时，
 * `x-forwarded-for` 才是可信的。裸奔在公网时任何人都能自己伪造这个头来绕过限流 ——
 * 同理，它也**不能**用来做访问控制，只能用来做「提高攻击成本」的节流。
 */
import type { H3Event } from 'h3';

export function clientIpOf(event: H3Event): string {
  const forwarded = getHeaders(event)['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0]!.trim();
  return event.node.req.socket.remoteAddress ?? 'unknown';
}
