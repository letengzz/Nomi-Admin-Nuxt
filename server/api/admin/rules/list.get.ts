/**
 * 规则节点列表（管理页用）。
 *
 * 与 `/api/admin/init` 返回的菜单树不同：这里包含按钮节点与禁用节点，
 * 目的是「管理」而不是「渲染侧边栏」。非超管只能看到自己有权的那部分，
 * 否则等于把整个系统的节点清单交给了他。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { buildRuleTree, ruleIdsToNumbers, type RuleRow } from '../../../utils/auth/rbac';
import { getPool } from '../../../database/pool';

async function loadAllRules(): Promise<RuleRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<RuleRow[]>(
    'SELECT * FROM `permission_rule` ORDER BY `weigh` DESC, `id` ASC',
  );
  return rows;
}

export default defineAdminHandler('system/rule/index', async (_event, context) => {
  const all = await loadAllRules();
  const mine = new Set(ruleIdsToNumbers(context.ruleIds));
  const rows = context.isSuper ? all : all.filter((rule) => mine.has(rule.id));

  return {
    list: rows,
    tree: buildRuleTree(rows),
    total: rows.length,
    super: context.isSuper,
    /** 新增/编辑时的「上级节点」下拉：只给启用中的节点 */
    enabled: rows.filter((rule) => rule.status === 1),
  };
});
