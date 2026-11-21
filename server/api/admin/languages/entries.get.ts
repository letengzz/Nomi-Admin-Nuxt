/** 词条分页：支持按 key / 任意译文搜索、按模块筛选。 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import {
  listEntries,
  normalizeEntryQuery,
} from '../../../utils/auth/language-service';

export default defineAdminHandler('system/language/index', async (event) =>
  listEntries(normalizeEntryQuery(getQuery(event))),
);
