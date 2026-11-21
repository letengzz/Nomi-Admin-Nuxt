/** 快速排序：只改 weigh，不碰其他字段。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import { getPool } from '../../../database/pool';
import { ruleIdsToNumbers } from '../../../utils/auth/rbac';

interface SortItem {
  id: number;
  weigh: number;
}

export default defineAdminHandler('system/rule/sortable', async (event, context) => {
  const body = await readBody<{ weights?: unknown }>(event);
  const raw = Array.isArray(body?.weights) ? body.weights : [];
  if (raw.length === 0) throw new ApiError('缺少排序数据');

  const items: SortItem[] = raw
    .map((item) => {
      const record = item as Record<string, unknown>;
      return { id: Number(record.id), weigh: Number(record.weigh) };
    })
    .filter((item) => Number.isInteger(item.id) && item.id > 0 && Number.isFinite(item.weigh));
  if (items.length === 0) throw new ApiError('排序数据不合法');

  const mine = new Set(ruleIdsToNumbers(context.ruleIds));
  if (!context.isSuper && items.some((item) => !mine.has(item.id))) {
    throw new ApiError('没有权限排序该节点');
  }

  const pool = getPool();
  for (const item of items) {
    await pool.query('UPDATE `permission_rule` SET `weigh` = ? WHERE `id` = ?', [item.weigh, item.id]);
  }
  return ok({ updated: items.length });
});
