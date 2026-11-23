/**
 * 请求元信息解析单测：IP 归类与归属地兜底。
 *
 * resolveIpLocation 会发真实 fetch，这里用 vi.stubGlobal 换成可控的假响应，
 * 并逐个恢复 process.env.IP_LOCATION_API —— 测试之间不能互相污染环境变量。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearIpLocationCache,
  localIpLabel,
  normalizeIp,
  parseUserAgent,
  resolveIpLocation,
} from '../server/utils/auth/request-meta';

const ORIGINAL_ENDPOINT = process.env.IP_LOCATION_API;

afterEach(() => {
  clearIpLocationCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (ORIGINAL_ENDPOINT === undefined) delete process.env.IP_LOCATION_API;
  else process.env.IP_LOCATION_API = ORIGINAL_ENDPOINT;
});

describe('parseUserAgent', () => {
  it('按优先级识别浏览器：Edge 带 Chrome 标记时不能被认成 Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
    expect(parseUserAgent(ua).browser).toBe('Edge 131');
  });

  it('识别终端系统', () => {
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)').os).toBe('iOS 17.0');
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)').os).toBe('Windows 10/11');
  });
});

describe('normalizeIp / localIpLabel', () => {
  it('IPv4-mapped IPv6 还原成 IPv4 后再判定', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(localIpLabel('::ffff:192.168.1.5')).toBe('monitor.location.lan');
  });

  it('回环 / 内网 / 链路本地 / 保留段各有词条，公网返回空', () => {
    expect(localIpLabel('127.0.0.1')).toBe('monitor.location.loopback');
    expect(localIpLabel('10.1.2.3')).toBe('monitor.location.lan');
    expect(localIpLabel('172.16.0.1')).toBe('monitor.location.lan');
    expect(localIpLabel('172.31.255.255')).toBe('monitor.location.lan');
    expect(localIpLabel('172.32.0.1')).toBe(''); // 公网段，别误判成内网
    expect(localIpLabel('169.254.1.1')).toBe('monitor.location.linkLocal');
    expect(localIpLabel('203.0.113.9')).toBe('monitor.location.reserved');
    expect(localIpLabel('46.202.129.79')).toBe('');
  });
});

describe('resolveIpLocation', () => {
  it('内网 IP 不查服务，直接返回词条键', async () => {
    vi.stubEnv('IP_LOCATION_API', 'http://geo.test/{ip}');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveIpLocation('192.168.1.10')).toBe('monitor.location.lan');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('公网 IP 未配服务 → 回落 monitor.location.public，不再留空', async () => {
    vi.stubEnv('IP_LOCATION_API', '');
    expect(await resolveIpLocation('46.202.129.79')).toBe('monitor.location.public');
  });

  it('配了服务且返回地名 → 展示真实地名', async () => {
    vi.stubEnv('IP_LOCATION_API', 'http://geo.test/{ip}');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ country: '中国', region: '广东', city: '深圳' }),
    }));
    expect(await resolveIpLocation('1.2.3.4')).toBe('中国 广东 深圳');
  });

  it('ip-api.com 格式：regionName 优先于 region 缩写，不显示「法国 IDF 巴黎」', async () => {
    vi.stubEnv('IP_LOCATION_API', 'http://ip-api.com/json/{ip}?lang=zh-CN');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ country: '法国', region: 'IDF', regionName: '法兰西岛', city: '巴黎' }),
    }));
    expect(await resolveIpLocation('46.202.129.79')).toBe('法国 法兰西岛 巴黎');
  });

  it('服务返回空对象 → 仍回落到公网 IP 词条', async () => {
    vi.stubEnv('IP_LOCATION_API', 'http://geo.test/{ip}');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await resolveIpLocation('1.2.3.4')).toBe('monitor.location.public');
  });

  it('服务报错 / 非 2xx → 静默降级，不让登录失败', async () => {
    vi.stubEnv('IP_LOCATION_API', 'http://geo.test/{ip}');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await resolveIpLocation('1.2.3.4')).toBe('monitor.location.public');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await resolveIpLocation('1.2.3.4')).toBe('monitor.location.public');
  });

  it('查到的真实地名会缓存：同一 IP 只打一次外部服务', async () => {
    vi.stubEnv('IP_LOCATION_API', 'http://geo.test/{ip}');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ country: '中国', city: '深圳' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveIpLocation('8.8.8.8')).toBe('中国 深圳');
    expect(await resolveIpLocation('8.8.8.8')).toBe('中国 深圳');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('降级结果不缓存：服务恢复后下一次登录能查到真实地名', async () => {
    vi.stubEnv('IP_LOCATION_API', 'http://geo.test/{ip}');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ country: '中国', city: '深圳' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveIpLocation('9.9.9.9')).toBe('monitor.location.public');
    expect(await resolveIpLocation('9.9.9.9')).toBe('中国 深圳');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('超时默认 2500ms，可用 IP_LOCATION_TIMEOUT 覆盖', async () => {
    vi.stubEnv('IP_LOCATION_API', 'http://geo.test/{ip}');
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ country: '中国', city: '深圳' }),
    }));

    await resolveIpLocation('7.7.7.7');
    expect(timeoutSpy).toHaveBeenLastCalledWith(2500);

    vi.stubEnv('IP_LOCATION_TIMEOUT', '5000');
    await resolveIpLocation('6.6.6.6');
    expect(timeoutSpy).toHaveBeenLastCalledWith(5000);

    timeoutSpy.mockRestore();
  });
});
