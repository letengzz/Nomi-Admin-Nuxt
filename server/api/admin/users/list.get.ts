/** 账号列表：支持按部门（含子部门）、状态、关键字筛选。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { listUsers, normalizeUserListQuery } from '../../../utils/auth/user-service';

export default defineAdminHandler('system/user/index', async (event, context) => {
  return listUsers(context, normalizeUserListQuery(getQuery(event)));
});
