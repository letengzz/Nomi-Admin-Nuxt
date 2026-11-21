/**
 * 恢复某个区块的默认配置：删掉该区块的覆盖行，不是把默认值再写一遍。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError } from '../../../utils/http';
import { loadSystemConfig, resetSectionConfig } from '../../../utils/system-config';

interface ResetBody {
  section?: unknown;
}

export default defineAdminHandler('system/settings/edit', async (event) => {
  const body = await readBody<ResetBody>(event);
  if (typeof body?.section !== 'string') throw new ApiError('缺少配置区块');
  try {
    await resetSectionConfig(body.section);
  } catch (error) {
    throw new ApiError((error as Error).message);
  }
  return ok(await loadSystemConfig());
});
