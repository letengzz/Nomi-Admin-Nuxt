/** 新增规则节点。新节点会自动追加给「拥有父节点」的所有分组（autoAssignPermission）。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ok } from '../../../utils/http';
import { createRule, normalizeRuleInput } from '../../../utils/auth/rule-service';

export default defineAdminHandler('system/rule/add', async (event, context) => {
  const input = await normalizeRuleInput(context, await readBody(event));
  const id = await createRule(input);
  return ok({ id });
});
