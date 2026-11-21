/**
 * 部门列表（扁平 + 直属人数）。
 *
 * 树由前端按 pid 拼；非超管只拿到「本部门 + 子部门」那一段，
 * 父级不在结果里的节点自然被前端渲染成根 —— 正好是以自己部门为根的视角。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { listDepartments } from '../../../utils/auth/department-service';
import { resolveDepartmentScope } from '../../../utils/auth/department-scope';

export default defineAdminHandler('system/department/index', async (_event, context) => {
  const scope = await resolveDepartmentScope(context);
  const list = await listDepartments(scope);
  return { list, total: list.length };
});
