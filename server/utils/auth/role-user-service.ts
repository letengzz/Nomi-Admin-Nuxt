/**
 * 角色 ↔ 账号的分配与取消分配。
 *
 * 与「编辑账号」的区别：那是一个账号的完整资料覆盖（角色列表整体替换），
 * 这里是**在角色维度上批量加减成员**，一次只动 `user_role` 的一行。
 *
 * 四道护栏：
 *   · 角色本身要能操作（非超管不能碰权限高于自己的角色，更不能碰 `'*'`）；
 *   · 目标账号要能操作（对方权限不低于你时不能改，且不允许对自己动手）；
 *   · 超管角色（`rules='*'`）至少保留一个成员，只剩一个时不允许取消分配；
 *   · 不能把最后一个超管从超管角色里移除 —— 否则系统里再没人能改权限。
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';
import { ApiError } from '../http';
import type { AdminContext } from './rbac';
import { assertRoleOperable, getRoleRow } from './role-service';
import {
  assertBatchOperable,
  countSupers,
  isSuperAccess,
  normalizeUserIds,
  revokeTokens,
} from './user-service';

export type RoleUserAction = 'add' | 'remove';

export function normalizeRoleUserAction(raw: unknown): RoleUserAction {
  if (raw === 'add' || raw === 'remove') return raw;
  throw new ApiError('不支持的操作类型');
}

/**
 * 超管角色的成员下限：`'*'` 角色只剩 1 个人时，取消分配会把系统锁死在
 * 「没人能改权限」的状态。抽成纯函数是为了不连库也能把规则钉死。
 */
export function assertSuperRoleCanRemove(isSuperRole: boolean, memberCount: number): void {
  if (isSuperRole && memberCount <= 1) {
    throw new ApiError('超级管理员角色至少保留一个成员，不能取消分配');
  }
}

/** 角色当前成员数（含被停用账号，因为角色关系还在）。 */
async function countRoleMembers(roleId: number): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<Array<{ total: number } & RowDataPacket>>(
    'SELECT COUNT(*) AS total FROM `user_role` WHERE `role_id` = ?',
    [roleId],
  );
  return Number(rows[0]?.total ?? 0);
}

/** 查这批账号里真正挂了这个角色的人，避免把「没变化的人」也踢下线。 */
async function currentMemberIds(roleId: number, userIds: readonly number[]): Promise<number[]> {
  const pool = getPool();
  const [rows] = await pool.query<Array<{ user_id: number } & RowDataPacket>>(
    'SELECT `user_id` FROM `user_role` WHERE `role_id` = ? AND `user_id` IN (?)',
    [roleId, userIds],
  );
  return rows.map((row) => Number(row.user_id));
}

export async function changeRoleUsers(
  context: AdminContext,
  rawRoleId: unknown,
  rawUserIds: unknown,
  action: RoleUserAction,
): Promise<{ affected: number }> {
  const roleId = Number(rawRoleId);
  if (!Number.isInteger(roleId) || roleId <= 0) throw new ApiError('缺少角色 id');
  const userIds = normalizeUserIds(rawUserIds);

  const role = await getRoleRow(roleId);
  assertRoleOperable(context, role);
  const targets = await assertBatchOperable(context, userIds);

  const pool = getPool();
  const existing = new Set(await currentMemberIds(roleId, userIds));
  const changed = userIds.filter((id) => (action === 'add' ? !existing.has(id) : existing.has(id)));
  if (changed.length === 0) return { affected: 0 };

  // 超管角色按 rules 哨兵判定即可：它已不允许停用，不必再看 status。
  const isSuperRole = (role.rules ?? '').trim() === '*';
  if (action === 'remove' && isSuperRole) {
    // 先看人数下限，再看「最后一个超管」。前者是角色维度的硬约束，
    // 后者是账号维度的兜底（成员可能挂了多个角色 / 被停用）。
    assertSuperRoleCanRemove(true, await countRoleMembers(roleId));
    const superTargets = targets.filter(
      (item) => isSuperAccess(item.access) && changed.includes(item.row.id),
    ).length;
    if (superTargets > 0 && superTargets >= (await countSupers())) {
      throw new ApiError('不能移除最后一个超级管理员');
    }
  }

  let affected: number;
  if (action === 'add') {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT IGNORE INTO `user_role` (`user_id`,`role_id`) VALUES ?',
      [changed.map((id) => [id, roleId])],
    );
    affected = result.affectedRows;
  } else {
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM `user_role` WHERE `role_id` = ? AND `user_id` IN (?)',
      [roleId, changed],
    );
    affected = result.affectedRows;
  }

  // 权限变了，前端 store 里的旧菜单要失效；踢掉 token 让对方下次请求重新登录。
  if (affected > 0) await revokeTokens(changed);
  return { affected };
}
