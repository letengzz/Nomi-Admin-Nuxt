/** 删除部门。顶级部门、有子部门或有成员都会被拒绝（见 department-service）。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { getPool } from '../../../database/pool';
import {
  assertDepartmentDeletable,
  getDepartmentRow,
} from '../../../utils/auth/department-service';
import {
  assertDepartmentScopeAllows,
  resolveDepartmentScope,
} from '../../../utils/auth/department-scope';

export default defineAdminHandler('system/department/del', async (event, context) => {
  const body = await readBody<{ id?: unknown }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少部门 id');

  const existing = await getDepartmentRow(id);
  if (!existing) throw new ApiError('部门不存在');

  assertDepartmentScopeAllows(await resolveDepartmentScope(context), id);
  await assertDepartmentDeletable(existing);

  const pool = getPool();
  await pool.query('DELETE FROM `department` WHERE `id` = ?', [id]);
  return ok({ id });
});
