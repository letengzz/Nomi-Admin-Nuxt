/**
 * 在线用户列表：一行 access token = 一个会话。
 *
 * 状态不是单独存的字段，而是由「预计失效」与「最后活跃」当场算：
 *   expired = 已过 expire_time；online = 5 分钟内有请求；其余 = away。
 * 过期但还没被清理任务（保留 2 天）删掉的会话仍在列表里，方便追溯。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { defineAdminHandler } from '../../../../utils/auth/handler';
import { getPool } from '../../../../database/pool';
import { digestToken, nowSeconds, TOKEN_TYPE_ADMIN } from '../../../../utils/auth/token';
import { resolveDepartmentScope, userScopeSubquery } from '../../../../utils/auth/department-scope';

/** 5 分钟内无请求视为「离开」，只是展示口径，不影响 token 有效性。 */
const ACTIVE_WINDOW = 300;

interface SessionRow extends RowDataPacket {
  session_id: string;
  user_id: number;
  nickname: string | null;
  username: string | null;
  ip: string;
  ip_location: string;
  browser: string;
  os: string;
  login_time: number;
  last_active_time: number;
  expire_time: number;
  last_refresh_time: number;
  status: 'online' | 'away' | 'expired';
  is_self: number;
}

export default defineAdminHandler('monitor/online/index', async (event, context) => {
  const now = nowSeconds();
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));
  const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
  const status = typeof query.status === 'string' ? query.status : '';

  const where = ['t.`type` = ?'];
  const params: unknown[] = [TOKEN_TYPE_ADMIN];

  const scope = userScopeSubquery(await resolveDepartmentScope(context));
  if (scope) {
    where.push(scope.clause);
    params.push(...scope.params);
  }

  if (status === 'online') {
    where.push('t.`expire_time` > ? AND t.`last_active_time` >= ?');
    params.push(now, now - ACTIVE_WINDOW);
  } else if (status === 'away') {
    where.push('t.`expire_time` > ? AND t.`last_active_time` < ?');
    params.push(now, now - ACTIVE_WINDOW);
  } else if (status === 'expired') {
    where.push('t.`expire_time` <= ?');
    params.push(now);
  }

  if (keyword) {
    where.push('(u.`nickname` LIKE ? OR u.`username` LIKE ? OR t.`ip` LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const pool = getPool();
  const join = 'FROM `token` t LEFT JOIN `user` u ON u.`id` = t.`user_id`';

  const [countRows] = await pool.query<Array<{ total: number } & RowDataPacket>>(
    `SELECT COUNT(*) AS total ${join} ${clause}`,
    params,
  );

  const [rows] = await pool.query<SessionRow[]>(
    `SELECT t.\`session_id\`, t.\`user_id\`, u.\`nickname\`, u.\`username\`,
            t.\`ip\`, t.\`ip_location\`, t.\`browser\`, t.\`os\`,
            t.\`create_time\` AS \`login_time\`, t.\`last_active_time\`,
            t.\`expire_time\`, t.\`last_refresh_time\`,
            CASE
              WHEN t.\`expire_time\` <= ? THEN 'expired'
              WHEN t.\`last_active_time\` >= ? THEN 'online'
              ELSE 'away'
            END AS \`status\`,
            (t.\`token\` = ?) AS \`is_self\`
       ${join} ${clause}
      ORDER BY t.\`last_active_time\` DESC, t.\`create_time\` DESC
      LIMIT ? OFFSET ?`,
    [now, now - ACTIVE_WINDOW, digestToken(context.token), ...params, limit, (page - 1) * limit],
  );

  return {
    list: rows,
    total: Number(countRows[0]?.total ?? 0),
    page,
    limit,
    serverTime: now,
  };
});
