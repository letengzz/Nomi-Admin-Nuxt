/**
 * 角色成员分配 / 取消分配。
 *
 * 挂在 `system/role/edit` 节点下：能给角色改权限，就能给角色加减人，
 * 不需要为这两个按钮再造一套权限节点。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import {
  changeRoleUsers,
  normalizeRoleUserAction,
} from '../../../utils/auth/role-user-service';

export default defineAdminHandler('system/role/edit', async (event, context) => {
  const body = await readBody<{ id?: unknown; userIds?: unknown; action?: unknown }>(event);
  const action = normalizeRoleUserAction(body?.action);
  return changeRoleUsers(context, body?.id, body?.userIds, action);
});
