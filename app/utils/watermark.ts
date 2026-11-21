/**
 * 水印 SVG 生成（纯函数，不碰 DOM / store）。
 *
 * 旧版只有「Nomi Admin · 内部使用」一行，画布 180×110 还以文字左端为旋转中心：
 * 14px 的中英混排本来就几乎顶满 180px，旋转 22° 后右端抬出上边界，
 * 平铺出来就是一排「半截字」——看起来像内容没渲染全。
 *
 * 现在把字号、画布、旋转中心一起重算：
 *   · 画布 380×220，文字居中、绕画布中心旋转，旋转后仍在画布内；
 *     画布比文字包围盒留足余量，平铺时两行之间不会连成一片；
 *   · 两行完整信息：系统名 + 用途 / 用户 + 时间 + 登录 IP；
 *   · 暗色主题换浅色墨迹，避免深色背景上完全看不见。
 */
export const WATERMARK_TILE = { width: 380, height: 220 } as const;

export interface WatermarkContent {
  systemName: string;
  internalLabel: string;
  userName: string;
  dateTime: string;
  ip?: string;
  dark?: boolean;
}

/** SVG data URI 是独立文档，特殊字符会直接破坏 XML，必须先转义。 */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[char] ?? char;
  });
}

/** 单行超长会顶出画布；宁可省略号也不要被裁成半截字。 */
export function clipWatermarkText(value: string, max = 46): string {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 本地时间的「年-月-日 时:分」，水印不需要秒。 */
export function formatWatermarkTime(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildWatermarkSvg(content: WatermarkContent): string {
  const first = clipWatermarkText(`${content.systemName} · ${content.internalLabel}`);
  const details = [content.userName, content.dateTime, content.ip].filter(Boolean).join(' · ');
  const second = clipWatermarkText(details);
  const { width, height } = WATERMARK_TILE;
  const cx = width / 2;
  const cy = height / 2;
  // currentColor 不跨 data URI，颜色只能写进 SVG。暗色主题用浅墨 + 稍高透明度。
  const fill = content.dark ? '#cbd5e1' : '#64748b';
  const opacity = content.dark ? '0.14' : '0.15';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<g transform="rotate(-22 ${cx} ${cy})" text-anchor="middle" font-family="Arial, 'Microsoft YaHei', sans-serif" ` +
    `fill="${fill}" fill-opacity="${opacity}">` +
    `<text x="${cx}" y="${cy - 6}" font-size="14" font-weight="600">${escapeXml(first)}</text>` +
    `<text x="${cx}" y="${cy + 18}" font-size="11.5">${escapeXml(second)}</text>` +
    `</g></svg>`
  );
}

export function toWatermarkBackground(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
