/** 新增部门。 */
import type { ResultSetHeader } from 'mysql2/promise';
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { getPool } from '../../../database/pool';
import {
  lockRootDepartmentStatus,
  normalizeDepartmentInput,
} from '../../../utils/auth/department-service';
import {
  assertDepartmentScopeAllows,
  resolveDepartmentScope,
} from '../../../utils/auth/department-scope';
import { nowSeconds } from '../../../utils/auth/token';

export default defineAdminHandler('system/department/add', async (event, context) => {
  const input = await normalizeDepartmentInput(await readBody(event));
  // 非超管只能在自己范围内建下级部门：pid=0（新的顶级部门）必然被拒。
  assertDepartmentScopeAllows(await resolveDepartmentScope(context), input.pid);
  // 顶级部门不能「一出生就是停用」，状态锁在写库前统一兜住。
  const status = lockRootDepartmentStatus(input.status, input.pid);
  const pool = getPool();
  const ts = nowSeconds();

  const [result] = await pool.query<ResultSetHeader>(
    'INSERT INTO `department` (`pid`,`name`,`leader`,`phone`,`weigh`,`status`,`create_time`,`update_time`) VALUES (?,?,?,?,?,?,?,?)',
    [input.pid, input.name, input.leader, input.phone, input.weigh, status, ts, ts],
  );
  if (!result.insertId) throw new ApiError('创建部门失败');
  return ok({ id: result.insertId });
});
