/** 角色列表。超管看到全部；普通账号看到全部，但 `assignable` 会标出不能动的角色。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { listRoles } from '../../../utils/auth/role-service';

export default defineAdminHandler('system/role/index', async (_event, context) => {
  const list = await listRoles(context);
  return { list, total: list.length, super: context.isSuper };
});
