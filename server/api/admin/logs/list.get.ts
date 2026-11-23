/**
 * 操作日志列表（系统日志页的「操作日志」Tab，也供用户详情抽屉取最近操作）。
 *
 * 与文档 `auth/AdminLog.php` 的一处**有意不同**：文档让非超管只看自己的日志，
 * 这里改成「看本部门及子部门所有人的日志」。日志的用途是团队级追溯
 * （谁在什么时候改了谁的数据），只看自己等于把审计变成个人操作记录。
 *
 * 列表不 SELECT 请求/响应头体：那些大字段只在展开详情时按 id 单独取，
 * 否则翻一页就会把几十 KB 的报文拉到浏览器。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { defineAdminHandler } from '../../../utils/auth/handler';
import { getPool } from '../../../database/pool';
import { resolveDepartmentScope, userScopeSubquery } from '../../../utils/auth/department-scope';

const LIST_COLUMNS = `\`id\`,\`user_id\`,\`username\`,\`url\`,\`title\`,\`module\`,\`trace_id\`,
  \`status\`,\`duration\`,\`error_msg\`,\`ip\`,\`ip_location\`,\`browser\`,\`os\`,\`useragent\`,\`create_time\``;

interface LogRow extends RowDataPacket {
  id: number;
  user_id: number;
  username: string;
  url: string;
  title: string;
  module: string;
  trace_id: string;
  status: string;
  duration: number;
  error_msg: string;
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
  // 按账号过滤（用户管理的「详情」抽屉用）：只影响「看谁的」，不影响「能看多少」。
  const userId = Number(query.userId ?? 0) || 0;
  const status = query.status === 'success' || query.status === 'fail' ? query.status : '';
  const module = typeof query.module === 'string' ? query.module.trim().slice(0, 50) : '';

  const where: string[] = [];
  const params: unknown[] = [];

  // 数据范围先落地：传了范围外的 userId 也只会得到空结果，不会绕过去。
  const scopeCondition = userScopeSubquery(await resolveDepartmentScope(context));
  if (scopeCondition) {
    where.push(scopeCondition.clause);
    params.push(...scopeCondition.params);
  }

  if (userId > 0) {
    where.push('`user_id` = ?');
    params.push(userId);
  }
  if (status) {
    where.push('`status` = ?');
    params.push(status);
  }
  if (module) {
    where.push('`module` = ?');
    params.push(module);
  }
  if (keyword) {
    where.push('(`url` LIKE ? OR `title` LIKE ? OR `username` LIKE ? OR `ip` LIKE ? OR `trace_id` LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like, like, like);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();
  const [countRows] = await pool.query<Array<{ total: number } & RowDataPacket>>(
    `SELECT COUNT(*) AS total FROM \`operation_log\` ${clause}`,
    params,
  );

  const [rows] = await pool.query<LogRow[]>(
    `SELECT ${LIST_COLUMNS} FROM \`operation_log\` ${clause} ORDER BY \`id\` DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return {
    list: rows,
    total: Number(countRows[0]?.total ?? 0),
    page,
    limit,
  };
});
