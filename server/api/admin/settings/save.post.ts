/**
 * 保存一个配置区块。只接受 section + values，键的范围由服务端白名单决定，
 * 页面传多一个字段进来也写不进库。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError } from '../../../utils/http';
import { loadSystemConfig, saveSectionConfig } from '../../../utils/system-config';

interface SaveBody {
  section?: unknown;
  values?: unknown;
}

export default defineAdminHandler('system/settings/edit', async (event) => {
  const body = await readBody<SaveBody>(event);
  if (typeof body?.section !== 'string') throw new ApiError('缺少配置区块');
  try {
    await saveSectionConfig(body.section, body.values);
  } catch (error) {
    throw new ApiError((error as Error).message);
  }
  return ok(await loadSystemConfig());
});
