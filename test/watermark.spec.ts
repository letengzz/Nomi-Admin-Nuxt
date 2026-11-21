/**
 * 水印 SVG 单测：内容完整 + 不再被画布裁切。
 *
 * 旧版只有一行、画布 180×110、绕文字左端旋转，平铺出来是半截字。
 * 这些断言钉住「两行信息、居中旋转、画布够大」三件事。
 */
import { describe, expect, it } from 'vitest';
import {
  buildWatermarkSvg,
  clipWatermarkText,
  escapeXml,
  formatWatermarkTime,
  toWatermarkBackground,
  WATERMARK_TILE,
} from '../app/utils/watermark';

const BASE = {
  systemName: 'Nomi Admin',
  internalLabel: '内部使用',
  userName: '超级管理员',
  dateTime: '2026-11-15 11:56',
  ip: '127.0.0.1',
};

describe('buildWatermarkSvg', () => {
  it('两行内容都完整：系统名 + 用途 / 用户 + 时间 + IP', () => {
    const svg = buildWatermarkSvg(BASE);
    expect(svg).toContain('Nomi Admin · 内部使用');
    expect(svg).toContain('超级管理员 · 2026-11-15 11:56 · 127.0.0.1');
    expect(svg.match(/<text/g)).toHaveLength(2);
  });

  it('画布够大且绕画布中心旋转、文字居中，不会切掉半截字', () => {
    const svg = buildWatermarkSvg(BASE);
    expect(svg).toContain(`width="${WATERMARK_TILE.width}" height="${WATERMARK_TILE.height}"`);
    expect(svg).toContain(
      `rotate(-22 ${WATERMARK_TILE.width / 2} ${WATERMARK_TILE.height / 2})`,
    );
    expect(svg).toContain('text-anchor="middle"');
    expect(WATERMARK_TILE.width).toBeGreaterThanOrEqual(320);
    expect(WATERMARK_TILE.height).toBeGreaterThanOrEqual(160);
  });

  it('缺 IP 时不会出现多余的分隔符', () => {
    const svg = buildWatermarkSvg({ ...BASE, ip: '' });
    expect(svg).toContain('超级管理员 · 2026-11-15 11:56</text>');
    expect(svg).not.toContain('· </text>');
  });

  it('特殊字符先转义，不会破坏 SVG 结构', () => {
    const svg = buildWatermarkSvg({ ...BASE, userName: 'A&B <admin> "x"' });
    expect(svg).toContain('A&amp;B &lt;admin&gt; &quot;x&quot;');
    expect(svg).not.toContain('<admin>');
    expect(escapeXml("a'b")).toBe('a&apos;b');
  });

  it('暗色主题换成浅色墨迹', () => {
    expect(buildWatermarkSvg(BASE)).toContain('fill="#64748b"');
    expect(buildWatermarkSvg({ ...BASE, dark: true })).toContain('fill="#cbd5e1"');
  });

  it('超长文字截断成省略号，保证不顶出画布', () => {
    expect(clipWatermarkText('a'.repeat(100), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(buildWatermarkSvg({ ...BASE, userName: 'x'.repeat(200) })).toContain('…');
  });
});

describe('水印辅助函数', () => {
  it('时间格式是年-月-日 时:分，空值返回空串', () => {
    expect(formatWatermarkTime(new Date(2026, 10, 15, 11, 56))).toBe('2026-11-15 11:56');
    expect(formatWatermarkTime(new Date(2026, 0, 2, 9, 5))).toBe('2026-01-02 09:05');
    expect(formatWatermarkTime(null)).toBe('');
    expect(formatWatermarkTime(new Date('invalid'))).toBe('');
  });

  it('data URI 把 # 编码掉，否则颜色会被当成片段标识符', () => {
    const url = toWatermarkBackground(buildWatermarkSvg(BASE));
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(url).toContain('%23');
    expect(url).not.toContain('fill="#64748b"');
  });
});
