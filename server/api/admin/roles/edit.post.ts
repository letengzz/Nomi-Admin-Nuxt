/**
 * 编辑角色（含授权）。
 *
 * 顺序很重要：**先确认「我能操作这个角色」，再校验「我要分配的权限」**。
 * 反过来会泄露信息 —— 攻击者能从错误文案里区分「角色不存在」和「角色存在但你动不了」。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { getPool } from '../../../database/pool';
import {
  assertRoleCodeAvailable,
  assertRoleOperable,
  getRoleRow,
  normalizeRoleInput,
} from '../../../utils/auth/role-service';
import { nowSeconds } from '../../../utils/auth/token';

export default defineAdminHandler('system/role/edit', async (event, context) => {
  const body = await readBody<{ id?: unknown }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少角色 id');

  const role = await getRoleRow(id);
  assertRoleOperable(context, role);

  const input = await normalizeRoleInput(context, body);
  if (input.pid === id) throw new ApiError('上级角色不能是自己');
  await assertRoleCodeAvailable(input.code, id);

  const isSuperRole = (role.rules ?? '').trim() === '*';
  // 停用它 = 所有超管同一瞬间失去全部权限，连把状态改回来的接口都进不去，
  // 只能手工改库。这条护栏必须比「不能停用自己」更硬。
  if (isSuperRole && input.status === 0) {
    throw new ApiError('超级管理员角色不能停用');
  }

  // 允许在表单里把 '*' 改成一串 id，等于一键让所有超管失去
  // 「未来新增节点自动拥有」的能力，这里强制保留。
  const rulesText = isSuperRole ? '*' : input.rulesText;
  // 即便有人绕过上面的护栏，写库时也不接受超管角色的停用状态。
  const status = isSuperRole ? 1 : input.status;

  const pool = getPool();
  await pool.query(
    'UPDATE `role` SET `pid` = ?, `name` = ?, `code` = ?, `rules` = ?, `status` = ?, `update_time` = ? WHERE `id` = ?',
    [input.pid, input.name, input.code, rulesText, status, nowSeconds(), id],
  );

  return ok({ id });
});
