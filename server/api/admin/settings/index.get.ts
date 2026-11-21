/**
 * 系统配置读取。列表页每个区块拿到的是「默认值 + 库里覆盖值」合并后的完整对象。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ok } from '../../../utils/http';
import { loadSystemConfig } from '../../../utils/system-config';

export default defineAdminHandler('system/settings/index', async () => {
  return ok(await loadSystemConfig());
});
