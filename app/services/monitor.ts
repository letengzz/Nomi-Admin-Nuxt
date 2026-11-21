/**
 * 系统监控接口。全部走 `apiFetch`：token 注入、409 续期重放、303 回登录页
 * 都在 request.ts 里统一处理，这里只保留「一行 URL + 一行类型」。
 */
import { apiFetch } from '../utils/request';
import type {
  ListResult,
  LoginLogItem,
  OnlineListResult,
  OperationLogDetail,
  OperationLogItem,
} from '../types/monitor';

export type OnlineQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: string;
};

export function fetchOnlineSessions(query: OnlineQuery = {}): Promise<OnlineListResult> {
  return apiFetch<OnlineListResult>('/api/admin/monitor/online/list', { query });
}

export function kickOnlineSession(sessionId: string): Promise<{ revoked: number }> {
  return apiFetch<{ revoked: number }>('/api/admin/monitor/online/kick', {
    method: 'POST',
    body: { sessionId },
  });
}

export type LoginLogQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  behavior?: string;
  status?: string;
};

export function fetchLoginLogs(query: LoginLogQuery = {}): Promise<ListResult<LoginLogItem>> {
  return apiFetch<ListResult<LoginLogItem>>('/api/admin/monitor/login-logs/list', { query });
}

export type OperationLogQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: string;
  module?: string;
  /** 用户管理「最近操作」抽屉也复用这个接口 */
  userId?: number;
};

export function fetchOperationLogs(
  query: OperationLogQuery = {},
): Promise<ListResult<OperationLogItem>> {
  return apiFetch<ListResult<OperationLogItem>>('/api/admin/logs/list', { query });
}

export function fetchOperationLogDetail(id: number): Promise<OperationLogDetail> {
  return apiFetch<OperationLogDetail>('/api/admin/logs/detail', { query: { id } });
}
