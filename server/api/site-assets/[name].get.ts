/**
 * 读取上传的站点图片。公开可访问 —— LOGO 和 favicon 本来就是公开信息。
 *
 * 只从 data/uploads 按白名单文件名读取；不走静态目录是为了让运行时上传的
 * 文件在生产构建里同样可见。文件名校验失败直接 404，不拼接任何外部输入路径。
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3';
import { getUploadDir, IMAGE_MIME, isSafeImageName } from '../../utils/site-assets';

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || '';
  if (!isSafeImageName(name)) {
    throw createError({ statusCode: 404, statusMessage: 'Image not found' });
  }

  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  try {
    const data = await readFile(resolve(getUploadDir(), name));
    setHeader(event, 'Content-Type', IMAGE_MIME[ext] || 'application/octet-stream');
    setHeader(event, 'X-Content-Type-Options', 'nosniff');
    setHeader(event, 'Cache-Control', 'public, max-age=86400');
    return data;
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Image not found' });
  }
});
