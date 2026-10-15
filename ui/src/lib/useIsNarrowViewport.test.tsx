import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useIsNarrowViewport, NARROW_QUERY } from './useIsNarrowViewport';

/** 可手动拨动的 matchMedia 替身，用于模拟断点跨越 */
function installMatchMedia(initial: boolean) {
  let matches = initial;
  const changeHandlers = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, h: () => void) => changeHandlers.add(h),
    removeEventListener: (_: string, h: () => void) => changeHandlers.delete(h),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  return {
    /** 模拟浏览器派发 change 事件（正常路径） */
    fireChange(next: boolean) {
      matches = next;
      for (const h of changeHandlers) h();
    },
    /** 只改值、不触发 change，模拟不派发断点事件的环境 */
    setSilently(next: boolean) {
      matches = next;
    },
    get listeners() {
      return changeHandlers.size;
    },
  };
}

function Probe() {
  const narrow = useIsNarrowViewport();
  return <span data-testid="v">{narrow ? 'narrow' : 'wide'}</span>;
}

beforeEach(() => {
  installMatchMedia(false);
});

describe('useIsNarrowViewport', () => {
  it('初始值来自 matchMedia', () => {
    installMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId('v')).toHaveTextContent('narrow');
  });

  it('断点跨越时跟随 change 事件', () => {
    const mm = installMatchMedia(false);
    render(<Probe />);
    expect(screen.getByTestId('v')).toHaveTextContent('wide');

    act(() => mm.fireChange(true));
    expect(screen.getByTestId('v')).toHaveTextContent('narrow');

    act(() => mm.fireChange(false));
    expect(screen.getByTestId('v')).toHaveTextContent('wide');
  });

  it('环境不派发 change 时，resize 兜底也能纠正', () => {
    // 这正是实机踩到的坑：视口从窄变宽但没有 change 事件，
    // 判定卡在旧值上会让编辑器在宽屏下也不挂载。
    const mm = installMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId('v')).toHaveTextContent('narrow');

    mm.setSilently(false);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('v')).toHaveTextContent('wide');
  });

  it('卸载后不再监听，避免泄漏', () => {
    const mm = installMatchMedia(false);
    const { unmount } = render(<Probe />);
    expect(mm.listeners).toBe(1);
    unmount();
    expect(mm.listeners).toBe(0);
  });

  it('查询串与 CSS 断点一致', () => {
    // 必须和 index.css 里那组 @media (max-width: 768px) 对齐
    expect(NARROW_QUERY).toBe('(max-width: 768px)');
  });
});
