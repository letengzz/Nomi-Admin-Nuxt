/**
 * 删除角色。
 *
 * 三条护栏（文档 7.2 与 11 章的实践经验）：
 *   · 角色下还有账号 → 拒绝（先解绑，否则这些人会变成「能登录但什么都没权限」）；
 *   · 超级管理员角色（rules='*'）→ 永远不可删；
 *   · 有下级角色 → 拒绝（避免出现指向不存在父级的孤儿角色）。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { getPool } from '../../../database/pool';
import {
  assertRoleOperable,
  getRoleMemberCounts,
  getRoleRow,
} from '../../../utils/auth/role-service';

export default defineAdminHandler('system/role/del', async (event, context) => {
  const body = await readBody<{ id?: unknown }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少角色 id');

  const role = await getRoleRow(id);
  assertRoleOperable(context, role);
  if ((role.rules ?? '').trim() === '*') throw new ApiError('超级管理员角色不可删除');

  const counts = await getRoleMemberCounts();
  if ((counts.get(id) ?? 0) > 0) throw new ApiError('该角色下还有账号，请先移除成员');

  const pool = getPool();
  const [children] = await pool.query<Array<{ id: number } & RowDataPacket>>(
    'SELECT `id` FROM `role` WHERE `pid` = ? LIMIT 1',
    [id],
  );
  if (children.length > 0) throw new ApiError('该角色下还有下级角色，请先删除下级角色');

  await pool.query('DELETE FROM `role` WHERE `id` = ?', [id]);
  return ok({ id });
});
