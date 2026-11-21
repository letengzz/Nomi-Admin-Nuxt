/**
 * 会话心跳接口。放在 services 里只为和其它接口一样走 `apiFetch`：
 * 303（令牌已失效）、409（过期续期）、续期失败跳登录页，全都由请求器统一处理。
 */
import { apiFetch } from '../utils/request';

export interface SessionPingResult {
  userId: number;
  /** 服务端 unix 秒，需要时可用来校正前端时钟 */
  serverTime: number;
}

export function pingSession(): Promise<SessionPingResult> {
  return apiFetch<SessionPingResult>('/api/admin/session/ping');
}
