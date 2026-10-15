import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useStore } from '../store';
import { EditorArea } from './EditorArea';

/**
 * Monaco 本身在 jsdom 里跑不起来（没有布局引擎），但这次要守的回归点不在 Monaco 内部：
 * 手机上「面板」与「编辑」是 display:none 互斥的两屏，若在隐藏时就挂载 Monaco，
 * 它会量到 0 尺寸并永久固定成 5×5，切过去只剩一条缝。所以这里只断言挂载时机。
 */
vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco" />,
}));

function setNarrow(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: narrow,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function seed(partial: Record<string, unknown>) {
  useStore.setState({
    openFiles: [{ path: 'src/a.ts', content: 'const a = 1;', modified: false }],
    activeFile: 'src/a.ts',
    activeFileError: null,
    mobileView: 'editor',
    filesPanelOpen: false,
    theme: 'dark',
    textVisible: true,
    ...partial,
  } as never);
}

beforeEach(() => {
  setNarrow(false);
});

describe('EditorArea 挂载时机', () => {
  it('宽屏：编辑区常驻可见，直接挂载编辑器', () => {
    setNarrow(false);
    seed({ mobileView: 'panel' }); // 宽屏下 CSS 忽略 mobileView，编辑区照样可见
    render(<EditorArea />);
    expect(screen.getByTestId('monaco')).toBeInTheDocument();
  });

  it('窄屏处于对话面板时：不挂载编辑器（此时容器是 display:none）', () => {
    setNarrow(true);
    seed({ mobileView: 'panel' });
    render(<EditorArea />);
    expect(screen.queryByTestId('monaco')).toBeNull();
  });

  it('窄屏切到编辑视图：挂载编辑器', () => {
    setNarrow(true);
    seed({ mobileView: 'editor' });
    render(<EditorArea />);
    expect(screen.getByTestId('monaco')).toBeInTheDocument();
  });

  it('窄屏从面板切到编辑：由不挂载变为挂载', () => {
    setNarrow(true);
    seed({ mobileView: 'panel' });
    const { rerender } = render(<EditorArea />);
    expect(screen.queryByTestId('monaco')).toBeNull();

    act(() => {
      useStore.setState({ mobileView: 'editor' } as never);
    });
    rerender(<EditorArea />);
    expect(screen.getByTestId('monaco')).toBeInTheDocument();
  });

  it('窄屏切回面板：卸载编辑器，不会留下停在 5×5 的实例', () => {
    setNarrow(true);
    seed({ mobileView: 'editor' });
    const { rerender } = render(<EditorArea />);
    expect(screen.getByTestId('monaco')).toBeInTheDocument();

    act(() => {
      useStore.setState({ mobileView: 'panel' } as never);
    });
    rerender(<EditorArea />);
    expect(screen.queryByTestId('monaco')).toBeNull();
  });

  it('窄屏但没有打开文件时显示空态，不挂载编辑器', () => {
    setNarrow(true);
    seed({ mobileView: 'editor', openFiles: [], activeFile: null });
    render(<EditorArea />);
    expect(screen.queryByTestId('monaco')).toBeNull();
  });
});
