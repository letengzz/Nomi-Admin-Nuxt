/**
 * 公开站点配置的客户端封装。
 *
 * 服务端返回的是 site / environment / seo 三个区块里「展示用」的子集；
 * 接口不可达时退回服务端同名默认值，保证页面至少有个能用的品牌名，
 * 而不是空白标题。
 */
import { callApi } from '../utils/api';

/** 环境标识：只认这三档，别的值一律当开发环境处理（宁可提示得保守）。 */
export type AppEnv = 'development' | 'testing' | 'production';

export interface SiteEnvironmentInfo {
  current: string;
  showBadge: boolean;
  devUrl: string;
  testUrl: string;
  prodUrl: string;
}

export interface SiteSeoInfo {
  titleTemplate: string;
  description: string;
  keywords: string;
  ogImage: string;
  canonicalBase: string;
  allowIndexing: boolean;
  ogType: string;
}

export interface SiteInfo {
  name: string;
  logo: string;
  favicon: string;
  description: string;
  copyrightEnabled: boolean;
  copyright: string;
  icp: string;
  environment: SiteEnvironmentInfo;
  seo: SiteSeoInfo;
}

export const DEFAULT_SITE_INFO: SiteInfo = {
  name: 'Nomi Admin',
  logo: '',
  favicon: '',
  description: '',
  copyrightEnabled: true,
  copyright: '',
  icp: '',
  environment: {
    current: 'development',
    showBadge: true,
    devUrl: '',
    testUrl: '',
    prodUrl: '',
  },
  seo: {
    titleTemplate: '',
    description: '',
    keywords: '',
    ogImage: '',
    canonicalBase: '',
    allowIndexing: false,
    ogType: 'website',
  },
};

/** 把任意字符串收敛成三档环境标识，认不出的一律当开发环境。 */
export function normalizeEnv(value: string | undefined | null): AppEnv {
  return value === 'production' || value === 'testing' ? value : 'development';
}

/** 当前环境对应的访问地址，canonical 兜底用。 */
export function envUrlOf(info: SiteEnvironmentInfo, current: string): string {
  const env = normalizeEnv(current);
  if (env === 'production') return (info.prodUrl || '').trim();
  if (env === 'testing') return (info.testUrl || '').trim();
  return (info.devUrl || '').trim();
}

/**
 * 老接口没有 environment / seo 字段（或某次发布前后端不同步）时，
 * 用默认值补齐再交给页面 —— 少一层字段就让整块配置读崩不值得。
 */
function normalizeSiteInfo(data: Partial<SiteInfo>): SiteInfo {
  return {
    ...DEFAULT_SITE_INFO,
    ...data,
    environment: { ...DEFAULT_SITE_INFO.environment, ...data.environment },
    seo: { ...DEFAULT_SITE_INFO.seo, ...data.seo },
  };
}

export async function fetchSiteInfo(): Promise<SiteInfo> {
  try {
    const response = await callApi<Partial<SiteInfo>>('/api/site');
    if (response?.code === 200 && response.data?.name) return normalizeSiteInfo(response.data);
  } catch {
    // 首屏品牌失败不该让整张页面挂掉，退回默认值即可。
  }
  return structuredClone(DEFAULT_SITE_INFO);
}
