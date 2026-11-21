/**
 * 审计日志写入：操作日志 + 登录日志。
 *
 * 只记「谁、什么时间、从哪台设备、打了哪个接口、改了什么」，**不记角色** ——
 * 角色会变，日志跟着变就没法追溯当时到底是谁有这个权限。
 *
 * 两个原则：
 *   · 密码/令牌类字段与请求头一律脱敏，日志本身不能变成泄密源；
 *   · 写库失败不影响业务：日志是旁路，不是事务的一部分。
 */
import { getPool } from '../../database/pool';
import { nowSeconds } from './token';
import { truncate, type RequestMeta } from './request-meta';

/** 密码类字段一律不落库。用正则而不是枚举 key，是为了兜住将来新加的字段名。 */
const SENSITIVE_KEY = /(pass(word)?|salt|secret|token|authorization|cookie)/i;
const MAX_DATA_LENGTH = 4000;
const MAX_RESPONSE_LENGTH = 12_000;

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeForLog(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY.test(key) ? '******' : sanitizeForLog(item, depth + 1);
    }
    return result;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export type LogBehavior = 'login' | 'logout' | 'failed' | 'locked' | 'kick';

export interface LoginLogInput {
  userId?: number;
  username?: string;
  nickname?: string;
  behavior: LogBehavior;
  status?: boolean;
  message?: string;
  meta: RequestMeta;
}

export async function recordLoginLog(input: LoginLogInput): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO \`login_log\`
        (\`user_id\`,\`username\`,\`nickname\`,\`behavior\`,\`status\`,\`message\`,
         \`ip\`,\`ip_location\`,\`browser\`,\`os\`,\`useragent\`,\`create_time\`)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.userId ?? 0,
        truncate(input.username ?? '', 50),
        truncate(input.nickname ?? '', 50),
        input.behavior,
        input.status === false ? 0 : 1,
        truncate(input.message ?? '', 255),
        truncate(input.meta.ip, 50),
        truncate(input.meta.ipLocation, 120),
        truncate(input.meta.browser, 60),
        truncate(input.meta.os, 60),
        truncate(input.meta.useragent, 255),
        nowSeconds(),
      ],
    );
  } catch (error) {
    console.warn('[login-log] 写日志失败（已忽略）', error instanceof Error ? error.message : error);
  }
}

export interface AdminLogInput {
  userId: number;
  username: string;
  url: string;
  /** 操作内容：命中的权限节点标题（常是 i18n key） */
  title: string;
  /** 所属模块：由接口路径推导的 i18n key */
  module: string;
  status: 'success' | 'fail';
  duration: number;
  errorMsg: string;
  /** 请求体，写入前脱敏并序列化 */
  data: unknown;
  requestHeaders: string;
  responseHeaders: string;
  responseBody: string;
  meta: RequestMeta;
}

export async function recordAdminLog(input: AdminLogInput): Promise<void> {
  try {
    const pool = getPool();
    let payload = '';
    if (input.data !== undefined && input.data !== null) {
      payload = JSON.stringify(sanitizeForLog(input.data)) ?? '';
      if (payload.length > MAX_DATA_LENGTH) payload = `${payload.slice(0, MAX_DATA_LENGTH)}…`;
    }
    await pool.query(
      `INSERT INTO \`operation_log\`
        (\`user_id\`,\`username\`,\`url\`,\`title\`,\`module\`,\`trace_id\`,\`status\`,\`duration\`,\`error_msg\`,
         \`data\`,\`request_headers\`,\`response_headers\`,\`response_body\`,
         \`ip\`,\`ip_location\`,\`browser\`,\`os\`,\`useragent\`,\`create_time\`)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.userId,
        truncate(input.username, 50),
        truncate(input.url, 255),
        truncate(input.title, 100),
        truncate(input.module, 50),
        truncate(input.meta.traceId, 40),
        input.status,
        Math.max(0, Math.round(input.duration)),
        truncate(input.errorMsg, 255),
        payload,
        truncate(input.requestHeaders, MAX_DATA_LENGTH),
        truncate(input.responseHeaders, MAX_DATA_LENGTH),
        truncate(input.responseBody, MAX_RESPONSE_LENGTH),
        truncate(input.meta.ip, 50),
        truncate(input.meta.ipLocation, 120),
        truncate(input.meta.browser, 60),
        truncate(input.meta.os, 60),
        truncate(input.meta.useragent, 255),
        nowSeconds(),
      ],
    );
  } catch (error) {
    console.warn('[admin-log] 写日志失败（已忽略）', error instanceof Error ? error.message : error);
  }
}
