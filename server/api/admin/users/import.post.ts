/**
 * 导入账号。一次请求承担两个阶段：
 *
 *   mode=parse  → 只解析 + 校验 + 查冲突，**不写库**，回预览；
 *   mode=commit → 解析一遍（服务端重新校验，不信任前端回传的行）后按策略写库。
 *
 * 为什么不做「解析接口 + 提交接口传回解析结果」：那样前端可以把行改成任何样子，
 * 服务端还得再校验一遍，等于同一份逻辑写两次。让文件重新走一遍解析更简单，
 * 而且「用户改完 Excel 又点了提交」这种情况下，写进去的一定是磁盘上的最新内容。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError, ok } from '../../../utils/http';
import {
  applyUserImport,
  MAX_IMPORT_BYTES,
  normalizeImportStrategies,
  parseUserImportFile,
  prepareUserImport,
} from '../../../utils/auth/user-import';

/** multipart 里取一个文本字段。字段缺失时返回 undefined，交给 normalize 走默认值。 */
function textField(
  parts: Awaited<ReturnType<typeof readMultipartFormData>>,
  name: string,
): string | undefined {
  const part = parts?.find((item) => item.name === name && !item.filename);
  return part ? part.data.toString('utf8') : undefined;
}

export default defineAdminHandler(
  { node: 'system/user/add', log: '导入账号' },
  async (event, context) => {
    const parts = await readMultipartFormData(event);
    const file = parts?.find((item) => item.name === 'file' && item.filename);
    if (!file) throw new ApiError('请选择要导入的 Excel 文件');

    const fileName = file.filename ?? '';
    if (!/\.(xlsx|xls)$/i.test(fileName)) throw new ApiError('只支持 xls、xlsx 格式');
    if (file.data.length === 0) throw new ApiError('文件内容为空');
    if (file.data.length > MAX_IMPORT_BYTES) {
      throw new ApiError(`文件不能超过 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB`);
    }

    const mode = textField(parts, 'mode') === 'commit' ? 'commit' : 'parse';
    const strategies = normalizeImportStrategies({
      onUsername: textField(parts, 'onUsername'),
      onEmail: textField(parts, 'onEmail'),
      onMobile: textField(parts, 'onMobile'),
      defaultStatus: textField(parts, 'defaultStatus'),
    });

    const rawRows = parseUserImportFile(file.data);
    const { preview, rows } = await prepareUserImport(context, rawRows, strategies);
    if (mode === 'parse') return ok({ mode, fileName, strategies, preview });

    const outcome = await applyUserImport(rows, strategies);
    return ok({ mode, fileName, strategies, preview, outcome });
  },
);
