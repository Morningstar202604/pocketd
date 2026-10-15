import { useState } from 'react';
import { useStore } from '../store';
import { COMMON_MODELS } from '../lib/presets';
import { EmptyState } from './StateView';

export function ModelDrop() {
  const { modelDropOpen, setModelDrop, apiConfig, updateConfig, showToast, setSettings } = useStore();
  const [customModel, setCustomModel] = useState('');
  const [filter, setFilter] = useState('');

  if (!modelDropOpen) return null;

  const selectModel = (name: string) => {
    updateConfig({ apiModel: name });
    showToast(`已切换到 ${name}`, 'ok');
    setModelDrop(false);
    setFilter('');
  };

  const visible = filter
    ? COMMON_MODELS.filter(
        (m) =>
          m.name.toLowerCase().includes(filter.toLowerCase()) ||
          m.sub.toLowerCase().includes(filter.toLowerCase()),
      )
    : COMMON_MODELS;

  return (
    <div
      data-model-drop
      role="dialog"
      aria-label="切换模型"
      style={{
        position: 'fixed',
        top: 'calc(48px + var(--safe-top))',
        right: 12,
        width: 320,
        maxWidth: 'calc(100vw - 24px)',
        background: 'var(--bg-alt)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow)',
        zIndex: 'var(--z-dropdown)' as unknown as number,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'fadeIn .12s ease',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 8 }}>切换模型</div>
        <input
          type="search"
          className="field"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="筛选…"
          aria-label="筛选模型"
          style={{ fontFamily: 'var(--font-sans)' }}
        />
      </div>

      <div style={{ maxHeight: 300, overflowY: 'auto', padding: 4 }} role="listbox" aria-label="模型列表">
        {visible.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="没有匹配的模型"
            description="直接在下方输入自定义模型名"
            compact
          />
        ) : (
          visible.map((m) => {
            const active = m.name === apiConfig.apiModel;
            return (
              <button
                key={m.name}
                type="button"
                role="option"
                aria-selected={active}
                className="row-btn"
                onClick={() => selectModel(m.name)}
                aria-label={`使用模型 ${m.name}${active ? '（当前）' : ''}`}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {m.name}
                </span>
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', flexShrink: 0 }}>
                  {m.sub}
                </span>
                {active && (
                  <span style={{ color: 'var(--accent)', flexShrink: 0 }} aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      <div style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
        <input
          type="text"
          className="field"
          value={customModel}
          onChange={(e) => setCustomModel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customModel.trim()) {
              selectModel(customModel.trim());
              setCustomModel('');
            }
          }}
          placeholder="自定义模型名，回车确认…"
          aria-label="自定义模型名"
        />
        <button
          type="button"
          className="btn"
          onClick={() => {
            setModelDrop(false);
            setSettings(true);
          }}
          style={{ width: '100%', marginTop: 6 }}
        >
          ⚙ 打开完整设置
        </button>
      </div>
    </div>
  );
}
