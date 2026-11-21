/**
 * 系统监控相关类型。
 *
 * 字段名沿用服务端返回的 snake_case（日志/令牌表就是这么存的），
 * 不做驼峰转换 —— 少一层映射就少一处对不上的可能。
 */

export type SessionStatus = 'online' | 'away' | 'expired';

export interface OnlineSession {
  session_id: string;
  user_id: number;
  nickname: string | null;
  username: string | null;
  ip: string;
  /** i18n 词条键或真实地名；空串表示未解析 */
  ip_location: string;
  browser: string;
  os: string;
  login_time: number;
  last_active_time: number;
  expire_time: number;
  last_refresh_time: number;
  status: SessionStatus;
  /** 1 = 当前登录者自己的会话 */
  is_self: number;
}

export interface ListResult<T> {
  list: T[];
  total: number;
  page: number;
  limit: number;
}

export interface OnlineListResult extends ListResult<OnlineSession> {
  /** 服务端时间戳（unix 秒），前端算「多久之前」用 */
  serverTime: number;
}

export type LoginBehavior = 'login' | 'logout' | 'failed' | 'locked' | 'kick';

export interface LoginLogItem {
  id: number;
  user_id: number;
  username: string;
  nickname: string;
  behavior: LoginBehavior | string;
  /** 1 成功 / 0 失败 */
  status: number;
  message: string;
  ip: string;
  ip_location: string;
  browser: string;
  os: string;
  useragent: string;
  create_time: number;
}

export interface OperationLogItem {
  id: number;
  user_id: number;
  username: string;
  url: string;
  title: string;
  /** i18n 词条键 */
  module: string;
  trace_id: string;
  status: 'success' | 'fail' | string;
  duration: number;
  error_msg: string;
  ip: string;
  ip_location: string;
  browser: string;
  os: string;
  useragent: string;
  create_time: number;
}

/** 展开行按需加载的完整报文。 */
export interface OperationLogDetail extends OperationLogItem {
  data: string | null;
  request_headers: string | null;
  response_headers: string | null;
  response_body: string | null;
}
