/** 新增 / 编辑语言。默认语言不允许停用；编辑时 code 不可改。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import {
  normalizeLanguageInput,
  saveLanguage,
} from '../../../utils/auth/language-service';

export default defineAdminHandler('system/language/edit', async (event) =>
  saveLanguage(normalizeLanguageInput(await readBody(event))),
);
