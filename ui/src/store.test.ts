import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useStore } from './store';
import { api } from './lib/api';

vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      search: vi.fn(),
      listFiles: vi.fn(),
      getFile: vi.fn(),
      replace: vi.fn(),
      respondApproval: vi.fn(),
      setPolicy: vi.fn(),
      getPolicy: vi.fn(),
    },
  };
});

const search = vi.mocked(api.search);
const respondApproval = vi.mocked(api.respondApproval);
const setPolicy = vi.mocked(api.setPolicy);
const getPolicy = vi.mocked(api.getPolicy);

beforeEach(() => {
  useStore.setState({
    searchResults: [],
    searchQuery: '',
    searchScanned: 0,
    searchLoading: false,
    searchError: null,
    curPath: '.',
    files: [],
    filesLoading: false,
    filesError: null,
    openFiles: [],
    activeFile: null,
    activeFileError: null,
  } as never);
});

describe('store.search', () => {
  it('请求失败时把错误写进 searchError，而不是伪装成「无结果」', async () => {
    search.mockResolvedValueOnce({
      results: [],
      filesScanned: 0,
      truncated: false,
      error: 'HTTP 500',
    });

    await useStore.getState().search('needle');

    const s = useStore.getState();
    // 这是修复前的 bug：接口失败会被吞掉，界面显示「没有匹配结果」
    expect(s.searchError).toBe('HTTP 500');
    expect(s.searchResults).toEqual([]);
  });

  it('成功但无匹配时 searchError 为 null（区分「无结果」与「失败」）', async () => {
    search.mockResolvedValueOnce({ results: [], filesScanned: 42, truncated: false });

    await useStore.getState().search('needle');

    const s = useStore.getState();
    expect(s.searchError).toBeNull();
    expect(s.searchScanned).toBe(42);
  });

  it('清空关键词会重置结果与错误', async () => {
    useStore.setState({ searchError: '旧错误', searchResults: [] } as never);

    await useStore.getState().search('   ');

    const s = useStore.getState();
    expect(s.searchError).toBeNull();
    expect(s.searchQuery).toBe('');
    expect(search).not.toHaveBeenCalled();
  });

  it('结果被截断时给出提示', async () => {
    const showToast = vi.fn();
    useStore.setState({ showToast } as never);
    search.mockResolvedValueOnce({
      results: [{ path: 'a.ts', line: 1, column: 1, text: 'x' }],
      filesScanned: 10,
      truncated: true,
    });

    await useStore.getState().search('needle');

    expect(showToast).toHaveBeenCalledWith('结果过多，已截断', 'info');
  });
});

describe('store.loadFiles / loadFile 错误处理', () => {
  it('loadFiles 失败写入 filesError 并复位 loading', async () => {
    vi.mocked(api.listFiles).mockRejectedValueOnce(new Error('路径不存在: nope'));

    await useStore.getState().loadFiles('nope');

    const s = useStore.getState();
    expect(s.filesError).toBe('路径不存在: nope');
    expect(s.filesLoading).toBe(false);
  });

  it('loadFiles 成功时清掉上一次的错误', async () => {
    useStore.setState({ filesError: '旧错误' } as never);
    vi.mocked(api.listFiles).mockResolvedValueOnce({
      items: [{ name: 'a.ts', path: 'a.ts', type: 'file' }],
      path: '.',
    });

    await useStore.getState().loadFiles('.');

    const s = useStore.getState();
    expect(s.filesError).toBeNull();
    expect(s.files).toHaveLength(1);
  });

  it('loadFile 失败记录 路径+原因，供编辑器错误态使用', async () => {
    vi.mocked(api.getFile).mockRejectedValueOnce(new Error('二进制文件，拒绝以文本读取: data.bin'));

    await useStore.getState().loadFile('data.bin');

    expect(useStore.getState().activeFileError).toEqual({
      path: 'data.bin',
      message: '二进制文件，拒绝以文本读取: data.bin',
    });
  });

  it('图片不按文本读取：直接打开供预览，不产生错误', async () => {
    // 之前打开图片必然报「二进制文件，拒绝以文本读取」——等于打不开图片
    vi.mocked(api.getFile).mockClear();

    await useStore.getState().loadFile('screenshots/shot.png');

    const s = useStore.getState();
    expect(s.activeFileError).toBeNull();
    expect(s.activeFile).toBe('screenshots/shot.png');
    expect(s.openFiles.some((f) => f.path === 'screenshots/shot.png')).toBe(true);
    // 关键：不该去请求文本内容
    expect(api.getFile).not.toHaveBeenCalled();
  });
});

describe('store 会话与审批策略', () => {
  it('respondApproval 先把本地卡片标记为已解决，再发请求', async () => {
    respondApproval.mockResolvedValueOnce({ ok: true });
    useStore.setState({
      sessions: [
        {
          id: 0,
          label: 's',
          messages: [
            {
              role: 'assistant',
              content: '',
              approvals: [{ id: 'a1', tool: 'bash', args: {}, danger: 'low', reason: 'x' }],
            },
          ],
        },
      ],
      curSession: 0,
      showToast: vi.fn(),
    } as never);

    await useStore.getState().respondApproval(0, 'a1', true, false);

    expect(respondApproval).toHaveBeenCalledWith('a1', true, false);
    const msg = useStore.getState().sessions[0].messages[0];
    expect(msg.approvals?.[0].resolved).toBe('approved');
  });

  it('setApprovalMode 成功后刷新策略，失败不静默', async () => {
    setPolicy.mockResolvedValueOnce({ ok: true, mode: 'strict' });
    getPolicy.mockResolvedValueOnce({ mode: 'strict', alwaysAllow: [], pendingApprovals: 0 });
    const showToast = vi.fn();
    useStore.setState({ showToast } as never);

    await useStore.getState().setApprovalMode('strict');

    expect(setPolicy).toHaveBeenCalledWith('strict');
    expect(useStore.getState().agentPolicy?.mode).toBe('strict');
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('strict'), 'ok');

    setPolicy.mockRejectedValueOnce(new Error('HTTP 500'));
    await useStore.getState().setApprovalMode('auto');
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'), 'error');
  });
});
