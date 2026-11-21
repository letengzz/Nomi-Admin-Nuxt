/**
 * 站点图片上传的落盘位置与读取规则。
 *
 * 放在项目 data/ 下而不是 public/：Nuxt 生产构建只把构建时的 public 拷进
 * .output/public，运行时写进去的文件不会被静态服务看见。这里用接口读取，
 * 开发/生产行为一致，同时能按扩展名校验文件名，挡住路径穿越。
 */
import { resolve } from 'node:path';

export const SITE_ASSET_PREFIX = '/api/site-assets/';
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
};

/** 文件名只允许这些字符 + 白名单扩展名；不含斜杠与点，天然挡住路径穿越。 */
const NAME_PATTERN = /^[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp|ico)$/;

export function isSafeImageName(name: string): name is string {
  return NAME_PATTERN.test(name);
}

export function getUploadDir(): string {
  return resolve(process.env.NOMI_UPLOAD_DIR || resolve(process.cwd(), 'data', 'uploads'));
}
