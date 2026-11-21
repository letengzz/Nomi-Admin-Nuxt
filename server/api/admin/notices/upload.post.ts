/**
 * 公告富文本里的图片上传。
 *
 * 复用站点图片的落盘位置与 /api/site-assets/{name} 读取规则：编辑器插入图片后
 * 拿到的是可公开读取的 URL，正文只存 HTML 字符串，不把 base64 塞进数据库。
 * 权限沿用「公告编辑」节点——能写公告的人才能传图，和表单是同一道闸。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError } from '../../../utils/http';
import {
  getUploadDir,
  IMAGE_MIME,
  MAX_IMAGE_BYTES,
  SITE_ASSET_PREFIX,
} from '../../../utils/site-assets';

export default defineAdminHandler(
  { node: 'system/notice/edit', log: '上传公告图片' },
  async (event) => {
    const parts = await readMultipartFormData(event);
    const file = parts?.find((item) => item.name === 'file' && item.filename);
    if (!file) throw new ApiError('请选择要上传的图片');
    if (!file.type?.startsWith('image/')) throw new ApiError('只支持图片文件');
    if (file.data.length > MAX_IMAGE_BYTES) throw new ApiError('图片不能超过 2MB');

    const ext = extname(file.filename!).slice(1).toLowerCase();
    if (!IMAGE_MIME[ext]) throw new ApiError('不支持的图片格式');

    const name = `notice-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    const dir = getUploadDir();
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, name), file.data);

    return { url: `${SITE_ASSET_PREFIX}${name}` };
  },
);
