import { useStore, GitBranch } from '../store';
import { api } from '../lib/api';
import { askPrompt } from '../lib/dialog';
import { EmptyState, ErrorState, InlineNotice } from './StateView';

export function GitPanel() {
  const {
    runGit, gitOut, gitLoading, gitError, gitBranches, gitBranchLoading, gitBranchError,
    loadGitBranches, gitCheckout, gitBranch, gitDeleteBranch,
  } = useStore();

  const tools = [
    { label: '📊 状态', ariaLabel: '查看 Git 状态', fn: async () => { const r = await api.gitStatus(); return { stdout: r.stdout || '(干净)', code: r.code }; } },
    { label: '🔄 差异', ariaLabel: '查看未暂存差异', fn: async () => { const r = await api.gitDiff(); return { stdout: r.stdout || '(无差异)', code: r.code }; } },
    { label: '📜 日志', ariaLabel: '查看 Git 提交日志', fn: async () => { const r = await api.gitLog(); return { stdout: r.stdout || '(无提交)', code: r.code }; } },
    { label: '➕ 暂存', ariaLabel: '暂存所有变更', fn: async () => { const r = await api.gitAdd(['.']); return { stdout: '已暂存所有变更', code: r.code }; } },
    { label: '📌 提交', ariaLabel: '打开提交信息弹窗', fn: async () => {
      const msg = await askPrompt({
        title: '提交变更',
        label: '提交信息（会先暂存所有变更）',
        value: 'chore: update',
        placeholder: 'feat: 描述这次改动',
        multiline: true,
        confirmText: '提交',
      });
      if (!msg) return { stdout: '已取消', code: 0 };
      await api.gitAdd(['.']);
      const r = await api.gitCommit(msg);
      return { stdout: r.stdout || `已提交: ${msg}`, code: r.code };
    } },
    { label: '🌿 分支', ariaLabel: '新建分支', fn: async () => {
      const name = await askPrompt({ title: '新建分支', label: '分支名', placeholder: 'feature/xxx', confirmText: '创建' });
      if (!name) return { stdout: '已取消', code: 0 };
      const r = await gitBranch(name);
      return { stdout: r.stdout || `已创建分支: ${name}`, code: r.code };
    } },
    { label: '🔀 合并', ariaLabel: '合并分支到当前分支', fn: async () => {
      const name = await askPrompt({ title: '合并分支', label: '要合并进来的分支名', confirmText: '合并' });
      if (!name) return { stdout: '已取消', code: 0 };
      const r = await api.gitMerge(name);
      return { stdout: r.stdout || `已合并 ${name}`, code: r.code };
    } },
    { label: '⬆ Push', ariaLabel: '推送到远程', fn: async () => {
      const r = await api.gitPush();
      return { stdout: r.stdout || r.stderr || 'Push 完成', code: r.code };
    } },
    { label: '⬇ Pull', ariaLabel: '从远程拉取', fn: async () => {
      const r = await api.gitPull();
      return { stdout: r.stdout || r.stderr || 'Pull 完成', code: r.code };
    } },
    { label: '🔃 Fetch', ariaLabel: '获取远程更新', fn: async () => {
      const r = await api.gitFetch();
      return { stdout: r.stdout || r.stderr || 'Fetch 完成', code: r.code };
    } },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        role="toolbar"
        aria-label="Git 操作"
        style={{
          display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap', flexShrink: 0,
        }}
      >
        {tools.map((t) => (
          <button
            key={t.label}
            type="button"
            className="btn-xs"
            onClick={() => runGit(t.fn)}
            disabled={gitLoading}
            aria-label={t.ariaLabel}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 分支列表 */}
      {(gitBranches.length > 0 || gitBranchLoading || gitBranchError) && (
        <div style={{
          padding: '6px 8px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-alt)', flexShrink: 0, maxHeight: 140, overflow: 'auto',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            marginBottom: 6, fontSize: 'var(--text-2xs)', fontWeight: 600, color: 'var(--fg-muted)',
          }}>
            <span aria-hidden="true">🌿</span>
            <span style={{ flex: 1 }}>分支 ({gitBranches.length})</span>
            {gitBranchLoading && <span className="spinner" aria-hidden="true" />}
            <button
              type="button"
              className="btn-xs"
              onClick={loadGitBranches}
              disabled={gitBranchLoading}
              aria-label="刷新分支列表"
              style={{ minHeight: 24, padding: '0 7px' }}
            >
              ↻
            </button>
          </div>
          {gitBranchError ? (
            <InlineNotice tone="error">读取分支失败：{gitBranchError}</InlineNotice>
          ) : gitBranches.length === 0 && !gitBranchLoading ? (
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)' }}>（无分支）</div>
          ) : (
            <BranchList branches={gitBranches} />
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {gitLoading && (
          <div
            role="status"
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px',
              fontSize: 'var(--text-2xs)', color: 'var(--fg-muted)',
            }}
          >
            <span className="spinner" aria-hidden="true" />
            执行中
          </div>
        )}
        {gitError && (
          <div style={{ padding: '8px 10px' }}>
            <InlineNotice tone="error">
              <span style={{ fontFamily: 'var(--font-mono)' }}>{gitError}</span>
            </InlineNotice>
          </div>
        )}
        {gitOut ? (
          <pre
            role="log"
            aria-label="Git 输出"
            style={{
              margin: 0, padding: 10, fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap', lineHeight: 'var(--leading-normal)',
              color: 'var(--fg)',
            }}
          >
            {gitOut}
          </pre>
        ) : (
          !gitLoading && !gitError && (
            <EmptyState
              icon="📋"
              title="还没有 Git 输出"
              description="点上方按钮查看状态、差异或日志；提交与分支操作会弹窗确认"
              compact
            />
          )
        )}
      </div>
    </div>
  );
}

function BranchList({ branches }: { branches: GitBranch[] }) {
  const { gitCheckout, gitDeleteBranch } = useStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {branches.map((b) => (
        <div
          key={b.fullName || b.name}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '3px 6px', borderRadius: 'var(--radius-sm)', minHeight: 32,
            background: b.current ? 'var(--accent-soft)' : 'transparent',
            borderLeft: `2px solid ${b.current ? 'var(--accent)' : 'transparent'}`,
          }}
        >
          <span
            style={{
              fontSize: 'var(--text-xs)', fontWeight: b.current ? 600 : 400,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
            title={b.subject ? `${b.name} — ${b.subject}` : b.name}
          >
            {b.current && (
              <span style={{ color: 'var(--accent)', marginRight: 3 }} aria-hidden="true">●</span>
            )}
            {b.name}
            {b.isRemote && (
              <span style={{ color: 'var(--fg-dim)', fontSize: 'var(--text-2xs)' }}> (远程)</span>
            )}
          </span>
          {b.ahead > 0 && (
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--success)' }} title={`领先 ${b.ahead} 个提交`}>
              ↑{b.ahead}
            </span>
          )}
          {b.behind > 0 && (
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--error)' }} title={`落后 ${b.behind} 个提交`}>
              ↓{b.behind}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {!b.current && !b.isRemote && (
            <>
              <button
                type="button"
                className="btn-xs"
                onClick={() => gitCheckout(b.name)}
                aria-label={`切换到分支 ${b.name}`}
                style={{ minHeight: 24, padding: '0 7px', color: 'var(--accent)' }}
              >
                切换
              </button>
              <button
                type="button"
                className="btn-xs"
                onClick={() => gitDeleteBranch(b.name)}
                aria-label={`删除分支 ${b.name}`}
                style={{ minHeight: 24, padding: '0 7px', color: 'var(--error)' }}
              >
                删除
              </button>
            </>
          )}
          {b.isRemote && (
            <span
              style={{
                fontSize: 'var(--text-2xs)', padding: '1px 6px', borderRadius: 'var(--radius-xs)',
                background: 'var(--bg-overlay)', color: 'var(--fg-dim)',
              }}
            >
              远程
            </span>
          )}
          {b.current && (
            <span
              style={{
                fontSize: 'var(--text-2xs)', padding: '1px 6px', borderRadius: 'var(--radius-xs)',
                background: 'var(--accent-soft)', color: 'var(--accent)',
              }}
            >
              当前
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
