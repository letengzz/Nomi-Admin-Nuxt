/** 语言列表 + 模块列表 + 词条总数（左侧面板与筛选下拉共用）。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { listLanguages } from '../../../utils/auth/language-service';

export default defineAdminHandler('system/language/index', async () => listLanguages());
