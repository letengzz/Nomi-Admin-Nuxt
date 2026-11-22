/**
 * 令牌子系统（对应 docs/权限系统设计.md 第 4 章）。
 *
 * 三件事被刻意保留成与文档一致：
 *   1. **双 token**：短效 access（3 天）+ 长效 refresh（30 天）；
 *   2. **409 续期协议**：access 过期时不是「请重新登录」，而是给前端一个
 *      「你可以拿 refresh 换新的」的业务码；
 *   3. **库里只存摘要**：`HMAC-SHA256(明文, TOKEN_SECRET)`，库被脱走也换不来登录态。
 *
 * 与文档的一处加固：refresh token 的 `type` 是 `admin_refresh`，而 access token
 * 是 `admin`。文档里两者同 type，意味着 refresh token 能当 access token 用；
 * 这里分开后，refresh token 只对续期接口有效。
 *
 * 「在线用户」把一行 access token 当作一个会话：两者用 session_id 配对，
 * 续期沿用同一个 session_id 并替换旧 access 行，所以刷新令牌不会让列表里
 * 凭空多出一个人，而 last_refresh_time 又如实记下了这次刷新。
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { H3Event } from 'h3';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';
import { getDbConfig } from '../../database/config';

export const TOKEN_TYPE_ADMIN = 'admin';
export const TOKEN_TYPE_ADMIN_REFRESH = 'admin_refresh';

/** access token 有效期：3 天（与 BuildAdmin 的 admin_token_keep_time 一致）。 */
export const ACCESS_TOKEN_TTL = 3 * 24 * 3600;
/** refresh token 有效期：30 天（refreshTokenKeepTime）。 */
export const REFRESH_TOKEN_TTL = 30 * 24 * 3600;
/** 活跃时间写入节流：同一个会话 20 秒内只写一次，避免每个接口都多一次 UPDATE。 */
const ACTIVE_TOUCH_INTERVAL = 20;

export type TokenType = typeof TOKEN_TYPE_ADMIN | typeof TOKEN_TYPE_ADMIN_REFRESH;

export interface TokenPair {
  token: string;
  refreshToken: string;
  /** unix 秒 */
  expireTime: number;
  refreshExpireTime: number;
}

/** 会话元数据：签发时写入两条 token 行，续期时原样沿用。 */
export interface SessionMeta {
  sessionId?: string;
  /** 登录时间；续期沿用旧值，让「登录时间」不因刷新而跳变 */
  loginTime?: number;
  lastRefreshTime?: number;
  ip?: string;
  ipLocation?: string;
  browser?: string;
  os?: string;
  useragent?: string;
  /** 登录所选部门，作为本次会话的数据范围根；续期时沿用 */
  scopeDepartmentId?: number;
}

export interface TokenRecord extends RowDataPacket {
  token: string;
  type: string;
  user_id: number;
  session_id: string;
  create_time: number;
  expire_time: number;
  last_active_time: number;
  last_refresh_time: number;
  ip: string;
  ip_location: string;
  browser: string;
  os: string;
  useragent: string;
  /** 登录所选部门，作为本次会话的数据范围根；0 = 按账号所属部门 */
  scope_department_id: number;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** 明文 token → 入库摘要。同一明文 + 同一密钥必然得到同一摘要，这是查表的前提。 */
export function digestToken(token: string): string {
  return createHmac('sha256', getDbConfig().tokenSecret).update(token).digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

async function insertToken(
  token: string,
  type: TokenType,
  userId: number,
  ttl: number,
  meta: SessionMeta & { sessionId: string },
): Promise<number> {
  const pool = getPool();
  const now = nowSeconds();
  const created = meta.loginTime ?? now;
  const expire = now + ttl;
  await pool.query(
    `INSERT INTO \`token\`
      (\`token\`,\`type\`,\`user_id\`,\`session_id\`,\`create_time\`,\`expire_time\`,
       \`last_active_time\`,\`last_refresh_time\`,\`ip\`,\`ip_location\`,\`browser\`,\`os\`,\`useragent\`,\`scope_department_id\`)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      digestToken(token),
      type,
      userId,
      meta.sessionId,
      created,
      expire,
      now,
      meta.lastRefreshTime ?? 0,
      meta.ip ?? '',
      meta.ipLocation ?? '',
      meta.browser ?? '',
      meta.os ?? '',
      meta.useragent ?? '',
      Number(meta.scopeDepartmentId) || 0,
    ],
  );
  return expire;
}

/**
 * 签发一对新 token。
 *
 * `keepLogin=false` 时不发 refresh token（返回空串），前端下次过期就只能重登 ——
 * 这与登录页「记住密码」不勾选时的行为一致。
 */
export async function issueTokenPair(
  userId: number,
  options: { keepLogin?: boolean } = {},
  meta: SessionMeta = {},
): Promise<TokenPair> {
  const shared: SessionMeta & { sessionId: string } = {
    ...meta,
    sessionId: meta.sessionId ?? randomUUID(),
    loginTime: meta.loginTime ?? nowSeconds(),
  };

  const token = randomToken();
  const expireTime = await insertToken(token, TOKEN_TYPE_ADMIN, userId, ACCESS_TOKEN_TTL, shared);

  if (options.keepLogin === false) {
    return { token, refreshToken: '', expireTime, refreshExpireTime: 0 };
  }

  const refreshToken = randomToken();
  const refreshExpireTime = await insertToken(
    refreshToken,
    TOKEN_TYPE_ADMIN_REFRESH,
    userId,
    REFRESH_TOKEN_TTL,
    shared,
  );
  return { token, refreshToken, expireTime, refreshExpireTime };
}

/** 按明文查记录。查不到返回 undefined，不抛错 —— 调用方要区分「无效」和「过期」。 */
export async function findToken(token: string, type: TokenType): Promise<TokenRecord | undefined> {
  if (!token) return undefined;
  const pool = getPool();
  const [rows] = await pool.query<TokenRecord[]>(
    'SELECT * FROM `token` WHERE `token` = ? AND `type` = ? LIMIT 1',
    [digestToken(token), type],
  );
  return rows[0];
}

export async function deleteToken(token: string, type: TokenType): Promise<void> {
  if (!token) return;
  const pool = getPool();
  await pool.query('DELETE FROM `token` WHERE `token` = ? AND `type` = ?', [digestToken(token), type]);
}

/** 退出登录：access 与 refresh 一起删（按 session_id 更彻底，兼容旧数据再按明文兜底）。 */
export async function revokeSession(token: string, refreshToken?: string): Promise<void> {
  const sessionId = await findSessionId(token);
  if (sessionId) {
    await revokeSessionBySessionId(sessionId);
    return;
  }
  await Promise.all([
    deleteToken(token, TOKEN_TYPE_ADMIN),
    refreshToken ? deleteToken(refreshToken, TOKEN_TYPE_ADMIN_REFRESH) : Promise.resolve(),
  ]);
}

async function findSessionId(token: string): Promise<string> {
  if (!token) return '';
  const pool = getPool();
  const [rows] = await pool.query<Array<{ session_id: string } & RowDataPacket>>(
    'SELECT `session_id` FROM `token` WHERE `token` = ? LIMIT 1',
    [digestToken(token)],
  );
  return rows[0]?.session_id ?? '';
}

/** 强退：按 session_id 一次删掉 access + refresh，返回受影响行数。 */
export async function revokeSessionBySessionId(sessionId: string): Promise<number> {
  if (!sessionId) return 0;
  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>(
    'DELETE FROM `token` WHERE `session_id` = ?',
    [sessionId],
  );
  return result.affectedRows;
}

/** 记录「最后活跃」：节流写，失败静默 —— 它只是监控数据，不能影响业务响应。 */
export function touchSession(record: TokenRecord): void {
  const now = nowSeconds();
  if (now - Number(record.last_active_time ?? 0) < ACTIVE_TOUCH_INTERVAL) return;
  void getPool()
    .query('UPDATE `token` SET `last_active_time` = ? WHERE `token` = ?', [now, record.token])
    .catch(() => undefined);
}

export interface RotateResult {
  tokens: TokenPair;
  userId: number;
}

/**
 * 用 refresh token 换一对新 token，并**作废用过的 refresh token**（轮换）。
 * 轮换的意义：refresh token 一旦泄露，攻击者用一次就会把正常用户踢下线，
 * 异常因此可被发现，而不是被静默长期利用。
 *
 * 会话身份（session_id / 登录时间 / 客户端信息）从旧 refresh 行继承，
 * 同时删掉同会话的旧 access 行，保证「在线用户」始终一人一行。
 */
export async function rotateByRefreshToken(refreshToken: string): Promise<RotateResult | undefined> {
  const record = await findToken(refreshToken, TOKEN_TYPE_ADMIN_REFRESH);
  if (!record) return undefined;
  if (record.expire_time <= nowSeconds()) {
    await deleteToken(refreshToken, TOKEN_TYPE_ADMIN_REFRESH).catch(() => undefined);
    return undefined;
  }

  const sessionId = record.session_id || record.token.slice(0, 32);
  const pool = getPool();
  await pool.query('DELETE FROM `token` WHERE `session_id` = ? AND `type` = ?', [
    sessionId,
    TOKEN_TYPE_ADMIN,
  ]);

  const tokens = await issueTokenPair(record.user_id, {}, {
    sessionId,
    loginTime: record.create_time || nowSeconds(),
    lastRefreshTime: nowSeconds(),
    ip: record.ip,
    ipLocation: record.ip_location,
    browser: record.browser,
    os: record.os,
    useragent: record.useragent,
    scopeDepartmentId: Number(record.scope_department_id) || 0,
  });
  await deleteToken(refreshToken, TOKEN_TYPE_ADMIN_REFRESH).catch(() => undefined);
  return { tokens, userId: record.user_id };
}

/**
 * token 从哪来。按文档 3.5.2 的兼容顺序：`batoken` 为主，
 * 同时接受 `ba-token` / `Authorization: Bearer`，方便用 curl / Postman 调试。
 */
export function readAccessToken(event: H3Event): string {
  const headers = getHeaders(event);
  const candidates = [
    headers.batoken,
    headers['ba-token'],
    headers['ba_token'],
    headers['x-token'],
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const auth = headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return '';
}

export function readRefreshToken(event: H3Event, body?: unknown): string {
  const headers = getHeaders(event);
  const fromHeader = headers['ba-refresh-token'];
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
  if (body && typeof body === 'object' && 'refreshToken' in body) {
    const value = (body as { refreshToken?: unknown }).refreshToken;
    if (typeof value === 'string') return value.trim();
  }
  return '';
}
