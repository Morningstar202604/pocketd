import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '../store';
import { FilePanel } from './FilePanel';
import { api } from '../lib/api';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listFiles: vi.fn(),
      getFile: vi.fn(),
      search: vi.fn(),
      replace: vi.fn(),
      getPolicy: vi.fn(),
      listTools: vi.fn(),
      mcpList: vi.fn(),
      getConfig: vi.fn(),
    },
  };
});

const listFiles = vi.mocked(api.listFiles);

function seed(partial: Partial<ReturnType<typeof useStore.getState>>) {
  useStore.setState(partial as never);
}

beforeEach(() => {
  useStore.setState({
    files: [],
    filesLoading: false,
    filesError: null,
    curPath: '.',
    fileFilter: '',
    filesPanelOpen: true,
    openFiles: [],
    activeFile: null,
    activeFileError: null,
  } as never);
});

describe('FilePanel 文件树', () => {
  it('加载中显示占位（骨架屏）而不是空白', () => {
    seed({ filesLoading: true, files: [] });
    render(<FilePanel />);
    // 骨架屏以 status 角色暴露，并带可见的占位块
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', '加载中');
    expect(status.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('加载失败显示错误与重试，重试成功后错误消失', async () => {
    listFiles.mockResolvedValueOnce({ items: [], path: '.' });
    seed({ filesError: '路径不存在: nope' });

    render(<FilePanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('路径不存在: nope');

    await userEvent.click(screen.getByRole('button', { name: '重试' }));

    // 断言用户可见的结果：错误提示消失，回到空态
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('空目录')).toBeInTheDocument();
    expect(listFiles).toHaveBeenCalledWith('.');
  });

  it('空目录显示空态而不是什么都不渲染', () => {
    seed({ files: [] });
    render(<FilePanel />);
    expect(screen.getByText('空目录')).toBeInTheDocument();
  });

  it('筛选无结果时提示的是「没有匹配的文件」，与空目录区分', () => {
    seed({ files: [], fileFilter: 'zzz' });
    render(<FilePanel />);
    expect(screen.getByText('没有匹配的文件')).toBeInTheDocument();
    expect(screen.getByText('「zzz」没有匹配项')).toBeInTheDocument();
  });

  it('列出目录与文件，目录排在文件前', () => {
    seed({
      files: [
        { name: 'zzz.ts', path: 'zzz.ts', type: 'file', size: 1024 },
        { name: 'src', path: 'src', type: 'directory' },
      ],
    });
    render(<FilePanel />);

    const rows = screen.getAllByRole('button').filter((b) => b.className.includes('row-btn'));
    expect(rows[0]).toHaveTextContent('src');
    expect(rows[1]).toHaveTextContent('zzz.ts');
  });

  it('点击文件会打开它（调用 getFile），点击目录只切换路径', async () => {
    vi.mocked(api.getFile).mockResolvedValue({ path: 'a.ts', content: 'x' });
    listFiles.mockResolvedValue({ items: [], path: 'src' });
    seed({
      files: [
        { name: 'src', path: 'src', type: 'directory' },
        { name: 'a.ts', path: 'a.ts', type: 'file' },
      ],
    });

    render(<FilePanel />);
    await userEvent.click(screen.getByText('a.ts'));
    await waitFor(() => expect(api.getFile).toHaveBeenCalledWith('a.ts'));

    await userEvent.click(screen.getByText('src'));
    await waitFor(() => expect(listFiles).toHaveBeenCalledWith('src'));
  });

  it('打开非图片的二进制文件时把错误写进 store（编辑器据此显示错误态）', async () => {
    vi.mocked(api.getFile).mockRejectedValueOnce(new Error('二进制文件，拒绝以文本读取: data.bin'));
    seed({ files: [{ name: 'data.bin', path: 'data.bin', type: 'file' }] });

    render(<FilePanel />);
    await userEvent.click(screen.getByText('data.bin'));

    await waitFor(() => {
      expect(useStore.getState().activeFileError).toEqual({
        path: 'data.bin',
        message: '二进制文件，拒绝以文本读取: data.bin',
      });
    });
  });

  it('点图片不报错，直接打开走预览', async () => {
    seed({ files: [{ name: 'shot.png', path: 'shot.png', type: 'file' }] });

    render(<FilePanel />);
    await userEvent.click(screen.getByText('shot.png'));

    await waitFor(() => expect(useStore.getState().activeFile).toBe('shot.png'));
    expect(useStore.getState().activeFileError).toBeNull();
  });

  it('非根目录时提供返回上级', async () => {
    listFiles.mockResolvedValue({ items: [], path: '.' });
    seed({ curPath: 'src/components', files: [] });

    render(<FilePanel />);
    await userEvent.click(screen.getByRole('button', { name: /返回上级/ }));
    await waitFor(() => expect(listFiles).toHaveBeenCalledWith('src'));
  });

  it('被忽略的条目带上「忽略」标记，且仍然可以点开', async () => {
    vi.mocked(api.getFile).mockResolvedValue({ path: 'vendor/lib.js', content: 'x' });
    seed({
      files: [
        { name: 'vendor', path: 'vendor', type: 'directory', ignored: true },
        { name: 'app.ts', path: 'app.ts', type: 'file', size: 10 },
      ],
    });
    render(<FilePanel />);

    // 标记本身可见（用户能理解为什么搜索找不到）
    expect(screen.getByText('忽略')).toBeInTheDocument();
    expect(screen.getByText('vendor').closest('button')).toHaveAttribute(
      'title',
      expect.stringContaining('命中忽略规则'),
    );

    // 但必须仍然进得去——忽略只影响搜索，不影响浏览
    listFiles.mockResolvedValue({ items: [], path: 'vendor' });
    await userEvent.click(screen.getByText('vendor'));
    await waitFor(() => expect(listFiles).toHaveBeenCalledWith('vendor'));
  });

  it('未标记忽略的条目不显示「忽略」，正常显示体积', () => {
    seed({ files: [{ name: 'app.ts', path: 'app.ts', type: 'file', size: 2048 }] });
    render(<FilePanel />);
    expect(screen.queryByText('忽略')).toBeNull();
    expect(screen.getByText('2K')).toBeInTheDocument();
  });

  it('显示隐藏文件开关：默认关，打开后重新拉取并展示点文件', async () => {
    listFiles.mockResolvedValueOnce({
      items: [{ name: '.gitignore', path: '.gitignore', type: 'file' }],
      path: '.',
    });
    seed({ showHidden: false });

    render(<FilePanel />);
    // 默认关：loadFiles 里过滤掉点文件
    await act(async () => {
      await useStore.getState().loadFiles('.');
    });
    await waitFor(() => expect(useStore.getState().files).toHaveLength(0));
    expect(screen.getByText('空目录')).toBeInTheDocument();

    listFiles.mockResolvedValueOnce({
      items: [{ name: '.gitignore', path: '.gitignore', type: 'file' }],
      path: '.',
    });
    const toggle = screen.getByRole('button', { name: '显示隐藏文件' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);

    await waitFor(() => expect(screen.getByText('.gitignore')).toBeInTheDocument());
    expect(useStore.getState().showHidden).toBe(true);
  });
});
