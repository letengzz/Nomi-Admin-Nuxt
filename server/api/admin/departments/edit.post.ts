/** 编辑部门。上级不能是自己或自己的下级（在 service 里连整棵子树一起挡）。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { getPool } from '../../../database/pool';
import {
  getDepartmentRow,
  lockRootDepartmentStatus,
  normalizeDepartmentInput,
} from '../../../utils/auth/department-service';
import {
  assertDepartmentScopeAllows,
  resolveDepartmentScope,
} from '../../../utils/auth/department-scope';
import { nowSeconds } from '../../../utils/auth/token';

export default defineAdminHandler('system/department/edit', async (event, context) => {
  const body = await readBody<{ id?: unknown }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少部门 id');

  const existing = await getDepartmentRow(id);
  if (!existing) throw new ApiError('部门不存在');

  const input = await normalizeDepartmentInput(body, { selfId: id });
  // 目标部门要在范围内；换上级时新上级也要在范围内（原有上级在范围外时允许保持不变）。
  const scope = await resolveDepartmentScope(context);
  assertDepartmentScopeAllows(scope, id);
  if (input.pid !== existing.pid) assertDepartmentScopeAllows(scope, input.pid);
  // 原本是顶级 / 这次被改成顶级的部门都不允许停用；直接调接口绕过前端开关也会被挡住。
  const status = lockRootDepartmentStatus(input.status, input.pid, existing.pid);
  const pool = getPool();
  await pool.query(
    'UPDATE `department` SET `pid`=?,`name`=?,`leader`=?,`phone`=?,`weigh`=?,`status`=?,`update_time`=? WHERE `id`=?',
    [input.pid, input.name, input.leader, input.phone, input.weigh, status, nowSeconds(), id],
  );

  return ok({ id });
});
