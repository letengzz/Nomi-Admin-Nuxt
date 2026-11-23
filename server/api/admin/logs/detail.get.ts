/**
 * 操作日志详情：展开行时按 id 取完整报文。
 *
 * 权限判定复用列表接口的两道闸 —— 入口节点 `system/log/index` + 部门数据范围，
 * 避免「列表里看不到的人，猜个 id 就能把详情拉出来」。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { defineAdminHandler } from '../../../utils/auth/handler';
import { getPool } from '../../../database/pool';
import { assertBusiness } from '../../../utils/http';
import { resolveDepartmentScope, userScopeSubquery } from '../../../utils/auth/department-scope';

export default defineAdminHandler('system/log/index', async (event, context) => {
  const id = Number(getQuery(event).id ?? 0) || 0;
  assertBusiness(id > 0, '缺少日志 ID');

  const where = ['`id` = ?'];
  const params: unknown[] = [id];
  const scope = userScopeSubquery(await resolveDepartmentScope(context));
  if (scope) {
    where.push(scope.clause);
    params.push(...scope.params);
  }

  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT * FROM \`operation_log\` WHERE ${where.join(' AND ')} LIMIT 1`,
    params,
  );
  assertBusiness(rows.length > 0, '日志不存在或无权查看');
  return rows[0];
});
