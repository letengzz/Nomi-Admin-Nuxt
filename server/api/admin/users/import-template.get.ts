/**
 * 下载导入模板。
 *
 * 模板由服务端生成而不是仓库里放一个 .xlsx：列顺序、必填标记、填写说明
 * 与解析器共用同一份定义（`IMPORT_FIELDS`），改一处不会出现
 * 「模板多一列、解析器不认」这种只能靠用户报错才发现的问题。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ok } from '../../../utils/http';
import { buildUserImportTemplate, timestampedFileName } from '../../../utils/auth/user-import';

export default defineAdminHandler('system/user/add', async () =>
  ok({
    fileName: timestampedFileName('user-import-template'),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: buildUserImportTemplate().toString('base64'),
  }),
);
