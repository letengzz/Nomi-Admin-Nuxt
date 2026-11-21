/** 编辑规则节点。改 name 会同时影响接口验权与前端按钮权限，所以唯一约束前置校验。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { getRuleById, normalizeRuleInput, updateRule } from '../../../utils/auth/rule-service';
import { ruleIdsToNumbers } from '../../../utils/auth/rbac';

export default defineAdminHandler('system/rule/edit', async (event, context) => {
  const body = await readBody<{ id?: unknown }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('缺少节点 id');

  const existing = await getRuleById(id);
  if (!existing) throw new ApiError('节点不存在');
  if (!context.isSuper && !ruleIdsToNumbers(context.ruleIds).includes(id)) {
    throw new ApiError('没有权限编辑该节点');
  }

  const input = await normalizeRuleInput(context, body, { id });
  await updateRule(id, input);
  return ok({ id });
});
