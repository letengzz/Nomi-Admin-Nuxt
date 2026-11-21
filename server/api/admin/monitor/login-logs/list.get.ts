/**
 * 登录日志列表（系统日志页的「登录日志」Tab）。
 *
 * 登录失败的 user_id 可能是 0（账号根本不存在），这类行对任何有查看权限的人
 * 都可见 —— 撞库尝试恰恰是最需要被看见的记录，不该因为「没有部门」被过滤掉。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { defineAdminHandler } from '../../../../utils/auth/handler';
import { getPool } from '../../../../database/pool';
import { resolveDepartmentScope, userScopeSubquery } from '../../../../utils/auth/department-scope';

interface LoginLogRow extends RowDataPacket {
  id: number;
  user_id: number;
  username: string;
  nickname: string;
  behavior: string;
  status: number;
  message: string;
  ip: string;
  ip_location: string;
  browser: string;
  os: string;
  useragent: string;
  create_time: number;
}

export default defineAdminHandler('system/log/index', async (event, context) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));
  const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
  const behavior = typeof query.behavior === 'string' ? query.behavior.trim().slice(0, 20) : '';
  const status = query.status === 'success' || query.status === 'fail' ? query.status : '';

  const where: string[] = [];
  const params: unknown[] = [];

  const scope = userScopeSubquery(await resolveDepartmentScope(context));
  if (scope) {
    where.push(`(\`user_id\` = 0 OR ${scope.clause})`);
    params.push(...scope.params);
  }

  if (behavior) {
    where.push('`behavior` = ?');
    params.push(behavior);
  }
  if (status) {
    where.push('`status` = ?');
    params.push(status === 'success' ? 1 : 0);
  }
  if (keyword) {
    where.push('(`nickname` LIKE ? OR `username` LIKE ? OR `ip` LIKE ? OR `message` LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like, like);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();
  const [countRows] = await pool.query<Array<{ total: number } & RowDataPacket>>(
    `SELECT COUNT(*) AS total FROM \`login_log\` ${clause}`,
    params,
  );
  const [rows] = await pool.query<LoginLogRow[]>(
    `SELECT * FROM \`login_log\` ${clause} ORDER BY \`id\` DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return {
    list: rows,
    total: Number(countRows[0]?.total ?? 0),
    page,
    limit,
  };
});
