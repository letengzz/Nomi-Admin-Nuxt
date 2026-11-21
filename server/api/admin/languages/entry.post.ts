/** 新增 / 编辑词条及其各语言译文。key 创建后不可改。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import {
  listLanguageCodes,
  normalizeEntryInput,
  saveEntry,
} from '../../../utils/auth/language-service';

export default defineAdminHandler('system/language/edit', async (event) => {
  const [body, codes] = await Promise.all([readBody(event), listLanguageCodes()]);
  return saveEntry(normalizeEntryInput(body, codes));
});
