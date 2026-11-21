/**
 * 系统配置里的 LOGO / 图标上传。
 *
 * 图片落到 data/uploads，返回可被公开读取的 /api/site-assets/{name} 地址。
 * 只接受 multipart 里的 file 字段，类型、大小、扩展名三重校验；
 * 权限沿用「系统配置编辑」节点，和保存配置是同一道闸。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { MultiPartData } from 'h3';
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError } from '../../../utils/http';
import {
  getUploadDir,
  IMAGE_MIME,
  MAX_IMAGE_BYTES,
  SITE_ASSET_PREFIX,
} from '../../../utils/site-assets';

const ALLOWED_KINDS = new Set(['logo', 'favicon']);

function partText(parts: MultiPartData[], name: string): string {
  const part = parts.find((item) => item.name === name);
  return part ? Buffer.from(part.data).toString('utf8').trim() : '';
}

export default defineAdminHandler(
  { node: 'system/settings/edit', log: '上传站点图片' },
  async (event) => {
    const parts = await readMultipartFormData(event);
    if (!parts?.length) throw new ApiError('没有收到图片');

    const kind = partText(parts, 'kind');
    if (!ALLOWED_KINDS.has(kind)) throw new ApiError('图片用途不正确');

    const file = parts.find((item) => item.name === 'file' && item.filename);
    if (!file) throw new ApiError('请选择要上传的图片');
    if (!file.type?.startsWith('image/')) throw new ApiError('只支持图片文件');
    if (file.data.length > MAX_IMAGE_BYTES) throw new ApiError('图片不能超过 2MB');

    const ext = extname(file.filename!).slice(1).toLowerCase();
    if (!IMAGE_MIME[ext]) throw new ApiError('不支持的图片格式');

    const name = `${kind}-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    const dir = getUploadDir();
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, name), file.data);

    return { url: `${SITE_ASSET_PREFIX}${name}` };
  },
);
