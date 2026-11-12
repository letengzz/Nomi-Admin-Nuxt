/**
 * 首帧主题脚本的行为校验。
 *
 * 这段脚本是「字符串形式的代码」，不跑一遍就等于没测过：它有独立于 TypeScript
 * 的一份色阶算法，一旦和 app/utils/theme.ts 走偏，症状是「首帧颜色对、运行后跳变」，
 * 只在真机上看得出。这里把它放进假 document 里跑一遍，逐条比对两边算出的变量。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_COLOR,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEYS,
} from '../shared/utils/theme-bootstrap';
import { buildPrimaryVars, THEME_COLORS } from '../app/utils/theme';

interface RunResult {
  vars: Record<string, string>;
  isDark: boolean;
  colorScheme: string;
}

function runScript(mode: string | null, color: string | null, prefersDark = false): RunResult {
  const vars: Record<string, string> = {};
  const classes = new Set<string>();
  const style = {
    colorScheme: '',
    setProperty: (name: string, value: string) => {
      vars[name] = value;
    },
  };
  const root = {
    // 脚本写的是 document.documentElement.style.colorScheme，不是元素本身的属性
    style,
    classList: {
      toggle: (name: string, force?: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
  };

  const document = { documentElement: root };
  const localStorage = {
    getItem: (key: string) => {
      if (key === THEME_STORAGE_KEYS.mode) return mode;
      if (key === THEME_STORAGE_KEYS.color) return color;
      return null;
    },
  };
  const window = { matchMedia: () => ({ matches: prefersDark }) };

   
  new Function('document', 'localStorage', 'window', THEME_BOOTSTRAP_SCRIPT)(
    document,
    localStorage,
    window,
  );

  return { vars, isDark: classes.has('dark'), colorScheme: style.colorScheme };
}

describe('主题存储键', () => {
  it('默认主色与 THEME_COLORS[0] 指向同一处', () => {
    expect(DEFAULT_THEME_COLOR).toBe(THEME_COLORS[0]);
  });
});

describe('THEME_BOOTSTRAP_SCRIPT', () => {
  it('亮色下与 buildPrimaryVars 输出完全一致', () => {
    const { vars, isDark, colorScheme } = runScript('light', '#1D84FF');
    expect(isDark).toBe(false);
    expect(colorScheme).toBe('light');
    expect(vars).toEqual(buildPrimaryVars('#1D84FF', false));
  });

  it('暗色下与 buildPrimaryVars 输出完全一致', () => {
    const { vars, isDark, colorScheme } = runScript('dark', '#60C041');
    expect(isDark).toBe(true);
    expect(colorScheme).toBe('dark');
    expect(vars).toEqual(buildPrimaryVars('#60C041', true));
  });

  it('auto 模式跟随系统偏好', () => {
    expect(runScript('auto', null, true).isDark).toBe(true);
    expect(runScript('auto', null, false).isDark).toBe(false);
  });

  it('兼容 useStorage 的 JSON 序列化存储（真实浏览器里存的是带引号的字符串）', () => {
    const { vars, isDark } = runScript('"dark"', '"#60C041"');
    expect(isDark).toBe(true);
    expect(vars).toEqual(buildPrimaryVars('#60C041', true));
  });

  it('无存储值时回退到默认主色，而不是留空等运行时补', () => {
    expect(runScript('light', null).vars['--el-color-primary']).toBe(DEFAULT_THEME_COLOR);
  });

  it('非法色值不会污染变量', () => {
    const { vars } = runScript('light', 'not-a-color');
    expect(vars['--el-color-primary']).toBe(DEFAULT_THEME_COLOR);
    expect(vars['--el-color-primary-light-9']).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('存储访问抛异常时静默降级，不影响其余初始化', () => {
    const document = {
      documentElement: {
        classList: { toggle: () => undefined },
        style: { setProperty: () => undefined },
        colorScheme: '',
      },
    };
    const localStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };

    expect(() => {
       
      new Function('document', 'localStorage', 'window', THEME_BOOTSTRAP_SCRIPT)(
        document,
        localStorage,
        { matchMedia: () => ({ matches: false }) },
      );
    }).not.toThrow();
  });
});
