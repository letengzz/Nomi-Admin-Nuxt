/** 新增角色。授权入参经过 sanitizeAssignRules，非超管不能分配自己没有的节点。 */
import type { ResultSetHeader } from 'mysql2/promise';
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { getPool } from '../../../database/pool';
import { assertRoleCodeAvailable, normalizeRoleInput } from '../../../utils/auth/role-service';
import { nowSeconds } from '../../../utils/auth/token';

export default defineAdminHandler('system/role/add', async (event, context) => {
  const input = await normalizeRoleInput(context, await readBody(event));
  await assertRoleCodeAvailable(input.code);

  const pool = getPool();
  const ts = nowSeconds();

  const [result] = await pool.query<ResultSetHeader>(
    'INSERT INTO `role` (`pid`,`name`,`code`,`rules`,`status`,`create_time`,`update_time`) VALUES (?,?,?,?,?,?,?)',
    [input.pid, input.name, input.code, input.rulesText, input.status, ts, ts],
  );

  if (!result.insertId) throw new ApiError('创建角色失败');
  return ok({ id: result.insertId });
});
