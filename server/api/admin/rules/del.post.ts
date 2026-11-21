/** 删除规则节点。有子节点则拒绝；删除后从所有角色的授权串里剔除该 id。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { deleteRule, getRuleById } from '../../../utils/auth/rule-service';
import { ruleIdsToNumbers } from '../../../utils/auth/rbac';

export default defineAdminHandler('system/rule/del', async (event, context) => {
  const body = await readBody<{ id?: unknown }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少节点 id');

  const existing = await getRuleById(id);
  if (!existing) throw new ApiError('节点不存在');
  if (!context.isSuper && !ruleIdsToNumbers(context.ruleIds).includes(id)) {
    throw new ApiError('没有权限删除该节点');
  }

  await deleteRule(id);
  return ok({ id });
});
