/**
 * 顶部公告滚动条的纯计算单测（不依赖 DOM）。
 */
import { describe, expect, it } from 'vitest';
import { marqueeOffset, nextCarouselIndex } from '../app/utils/notice-marquee';

describe('顶部公告跑马灯位移', () => {
  it('文字未溢出时不位移', () => {
    expect(marqueeOffset(120, 300)).toBe(0);
    expect(marqueeOffset(300, 300)).toBe(0);
  });

  it('文字溢出时返回需要向左平移的负像素', () => {
    expect(marqueeOffset(420, 300)).toBe(-120);
  });

  it('脏数据（非有限值 / 容器为 0）不位移', () => {
    expect(marqueeOffset(Number.NaN, 300)).toBe(0);
    expect(marqueeOffset(420, 0)).toBe(0);
  });
});

describe('顶部公告轮播下标', () => {
  it('单条或空列表保持原位', () => {
    expect(nextCarouselIndex(0, 1)).toBe(0);
    expect(nextCarouselIndex(0, 0)).toBe(0);
  });

  it('多条时按取模顺序轮播并回绕', () => {
    expect(nextCarouselIndex(0, 3)).toBe(1);
    expect(nextCarouselIndex(1, 3)).toBe(2);
    expect(nextCarouselIndex(2, 3)).toBe(0);
  });
});
