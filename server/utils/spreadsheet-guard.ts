/**
 * 上传表格的「进门检查」：在把字节交给解析器之前先做三件事。
 *
 *   1. **认容器**：xlsx 是 ZIP，xls 是 OLE2 复合文档，两者的开头几个字节固定。
 *      一段既不是 ZIP 也不是 OLE2 的字节没有任何解析价值，早点拒绝，
 *      省得解析器在垃圾数据上做一圈无用功（解析器的健壮性是别人的代码，
 *      我们能控制的是「不把明显不该解析的东西喂进去」）。
 *   2. **量尺寸**：ZIP 的中央目录里写着每个条目的压缩前大小。一个 5MB 的 xlsx
 *      可以声明自己解压后有几个 GB —— 这就是 zip 炸弹。上传限制只看压缩后大小，
 *      所以必须在解压前读这份「报价单」。
 *   3. **限规模**：由调用方传进来的行/列上限，避免 `!ref` 被写成 `A1:XFD1048576`
 *      时把内存拉爆（`sheet_to_json` 会按这个矩形铺满数组）。
 *
 * 这里只做**结构层**的判断，不解析单元格内容 —— 单元格怎么读仍然是解析器的事。
 */
import { ApiError } from './http';

export type SpreadsheetFormat = 'xlsx' | 'xls';

/** ZIP 的四种签名（普通 / 空归档 / 分卷）都以 `PK` 开头。 */
function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** OLE2 复合文档头：`D0 CF 11 E0 A1 B1 1A E1`（xls / doc / ppt 共用）。 */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function isOle2(buffer: Buffer): boolean {
  if (buffer.length < OLE2_SIGNATURE.length) return false;
  return OLE2_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

/** 按文件内容认格式。认不出来返回 `null`（不看扩展名，扩展名是用户可以随便改的）。 */
export function detectSpreadsheetFormat(buffer: Buffer): SpreadsheetFormat | null {
  if (isZip(buffer)) return 'xlsx';
  if (isOle2(buffer)) return 'xls';
  return null;
}

/** 解压后总大小的上限。500 行账号数据实际不到 100KB，这里留了三个数量级的余量。 */
export const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
/** ZIP 条目数上限。正常 xlsx 是 10~30 个条目；几万个条目只可能是刻意构造的。 */
const MAX_ZIP_ENTRIES = 4096;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
/** EOCD 固定 22 字节 + 最长 65535 字节注释，从尾部往前找最多看这么多。 */
const EOCD_SEARCH_LIMIT = 22 + 0xffff;

/**
 * 读 ZIP 中央目录，把「解压后大小」加出来。
 *
 * 为什么读中央目录而不是解压一遍再量：解压就是攻击本身，量必须在解压前完成。
 * 中央目录记录的 `uncompressed size` 会被真正的解压器采信（否则解不出来），
 * 所以它是一份可信的「报价单」。
 */
function zipUncompressedBytes(buffer: Buffer): number {
  const scanStart = Math.max(0, buffer.length - EOCD_SEARCH_LIMIT);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= scanStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new ApiError('文件已损坏或不是完整的 Excel 文件，请重新导出后上传');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  if (entryCount > MAX_ZIP_ENTRIES) throw new ApiError('文件结构异常，请重新导出后上传');

  let cursor = buffer.readUInt32LE(eocd + 16);
  let total = 0;
  for (let index = 0; index < entryCount; index += 1) {
    // 中央目录条目被截断：文件本身不自洽，交给调用方当「无法解析」处理。
    if (cursor + 46 > buffer.length) throw new ApiError('文件已损坏或不是完整的 Excel 文件，请重新导出后上传');
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new ApiError('文件已损坏或不是完整的 Excel 文件，请重新导出后上传');
    }

    const uncompressed = buffer.readUInt32LE(cursor + 24);
    // ZIP64 才会出现 0xFFFFFFFF（>4GB）。账号导入不可能需要它，直接当超限处理，
    // 免得攻击者用一个假标记绕过统计。
    if (uncompressed === 0xffffffff) throw new ApiError('文件过大，请拆分后重试');
    total += uncompressed;
    if (total > MAX_UNCOMPRESSED_BYTES) {
      throw new ApiError(
        `文件解压后超过 ${Math.round(MAX_UNCOMPRESSED_BYTES / 1024 / 1024)}MB，请拆分后重试`,
      );
    }

    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return total;
}

/**
 * 解析前的准入检查。不通过就抛 `ApiError`（4xx 文案直接给到用户）。
 *
 * 只判断「容器对不对、解压后有多大」；行/列这类**业务**上限留给调用方 ——
 * 同一个守卫将来还要给其它导入功能用，上限不该写死在这里。
 */
export function assertSpreadsheetReadable(buffer: Buffer): SpreadsheetFormat {
  const format = detectSpreadsheetFormat(buffer);
  if (!format) throw new ApiError('文件解析失败，请确认是有效的 Excel 文件');

  if (format === 'xlsx') zipUncompressedBytes(buffer);
  return format;
}

/** 单元格文本的长度上限：再长的值不可能通过任何字段校验，留着只是占内存。 */
export const MAX_CELL_TEXT_LENGTH = 512;

/** 按上限截断单元格文本（正常数据远小于这个值）。 */
export function clampCellText(text: string): string {
  return text.length > MAX_CELL_TEXT_LENGTH ? text.slice(0, MAX_CELL_TEXT_LENGTH) : text;
}
