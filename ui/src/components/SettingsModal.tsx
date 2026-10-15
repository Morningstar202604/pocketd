import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, type AgentToolInfo, type ApprovalMode } from '../lib/api';
import { PRESETS } from '../lib/presets';
import { BRAND } from '../lib/brand';

const MODE_DESC: Record<ApprovalMode, string> = {
  auto: '不询问，仅拦截已知破坏性命令',
  edits: '改文件放行；执行命令、删除、MCP 工具需批准',
  strict: '除只读工具外全部需批准',
};

export function SettingsModal() {
  const {
    settingsOpen, setSettings, apiConfig, updateConfig, checkApi, showToast,
    mcpServers, addMcpServer, toggleMcpServer, removeMcpServer, syncMcpServers,
    agentPolicy, loadPolicy, setApprovalMode, clearAlwaysAllow,
    theme, toggleTheme,
  } = useStore();

  const [base, setBase] = useState(apiConfig.apiBase);
  const [key, setKey] = useState(apiConfig.apiKey);
  const [model, setModel] = useState(apiConfig.apiModel);
  const [temp, setTemp] = useState(String(apiConfig.temperature ?? 0.7));
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [mcpType, setMcpType] = useState<'http' | 'stdio'>('http');
  const [mcpName, setMcpName] = useState('');
  const [mcpValue, setMcpValue] = useState('');
  const [mcpArgs, setMcpArgs] = useState('');
  const [token, setToken] = useState('');
  const [tools, setTools] = useState<AgentToolInfo[]>([]);

  // 打开设置时同步后端状态，并把当前配置回填到输入框
  // （本组件常驻挂载，useState 初值只在首次渲染取一次，不回填就会显示旧值）
  useEffect(() => {
    if (!settingsOpen) return;
    syncMcpServers();
    loadPolicy();
    setBase(apiConfig.apiBase);
    setKey(apiConfig.apiKey);
    setModel(apiConfig.apiModel);
    setTemp(String(apiConfig.temperature ?? 0.7));
    api.listTools().then((r) => setTools(r.tools)).catch(() => setTools([]));
    api.getToken().then((r) => setToken(r.token)).catch(() => setToken(''));
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  const handleAddMcp = () => {
    const name = mcpName.trim();
    if (!name) {
      showToast('请填写 MCP 服务器名称', 'error');
      return;
    }
    if (mcpType === 'http') {
      const url = mcpValue.trim();
      if (!url) {
        showToast('HTTP 服务器需要 URL', 'error');
        return;
      }
      addMcpServer({ name, type: 'http', url });
    } else {
      const command = mcpValue.trim();
      if (!command) {
        showToast('stdio 服务器需要命令，例如 node / npx', 'error');
        return;
      }
      const args = mcpArgs.trim() ? mcpArgs.trim().split(/\s+/) : [];
      addMcpServer({ name, type: 'stdio', command, args });
    }
    setMcpName('');
    setMcpValue('');
    setMcpArgs('');
  };

  const handleSave = async () => {
    await updateConfig({
      apiBase: base.trim(),
      apiKey: key.trim(),
      apiModel: model.trim(),
      temperature: parseFloat(temp) || 0.7,
    });
    setSettings(false);
    showToast('已保存', 'ok');
    checkApi();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testEndpoint({
        apiBase: base.trim(),
        apiModel: model.trim(),
        ...(key.trim() ? { apiKey: key.trim() } : {}),
      });
      if (r.ok) setTestResult({ ok: true, msg: 'OK' });
      else setTestResult({ ok: false, msg: r.error || `HTTP ${r.status}` });
    } catch (e: unknown) {
      setTestResult({ ok: false, msg: (e as Error).message });
    }
    setTesting(false);
  };

  const handleExport = () => {
    const data = JSON.stringify({ apiBase: base, apiKey: key, apiModel: model }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${BRAND.id}-config.json`;
    a.click();
  };

  const handleImport = () => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = '.json';
    el.onchange = async () => {
      const f = el.files?.[0];
      if (!f) return;
      try {
        const cfg = JSON.parse(await f.text());
        if (cfg.apiBase) setBase(cfg.apiBase);
        if (cfg.apiKey) setKey(cfg.apiKey);
        if (cfg.apiModel) setModel(cfg.apiModel);
        showToast('已导入', 'ok');
      } catch { showToast('导入失败', 'error'); }
    };
    el.click();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="API 设置"
      style={overlay}
      onClick={(e) => e.target === e.currentTarget && setSettings(false)}
    >
      <div style={card}>
        <div style={head}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>API 设置</h2>
          <button onClick={() => setSettings(false)} style={xBtn} aria-label="关闭设置">✕</button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto' }}>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>一键预设提供商</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setBase(p.base); setModel(p.model); }}
                  style={chip}
                  aria-label={`使用 ${p.name} 预设`}
                >
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>API Base URL</label>
            <input type="text" value={base} onChange={(e) => setBase(e.target.value)} style={inp} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>API Key</label>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} style={inp} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>模型</label>
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)} style={inp} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>温度</label>
              <input type="number" min="0" max="2" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} style={inp} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <button onClick={handleTest} style={testBtn} aria-label="测试 API 连接">测试连接</button>
            {testing && <span style={spin} />}
            {testResult && (
              <span style={{ fontSize: 'var(--text-sm)', color: testResult.ok ? "var(--success)" : "var(--error)" }}>
                {testResult.msg}
              </span>
            )}
          </div>

          {/* 外观：顶栏那个切换按钮因此变成可选，而不是唯一入口 */}
          <Section title="外观" defaultOpen={false}>
            <div style={{ display: 'flex', gap: 5 }}>
              {(['dark', 'light'] as const).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => {
                    if (theme !== t) toggleTheme();
                  }}
                  aria-pressed={theme === t}
                  style={{
                    ...chip,
                    background: theme === t ? 'var(--accent-soft, var(--bg))' : 'var(--bg)',
                    borderColor: theme === t ? 'var(--accent)' : 'var(--border)',
                    color: theme === t ? 'var(--accent)' : 'var(--fg-muted)',
                  }}
                >
                  {t === 'dark' ? '🌙 深色' : '☀️ 浅色'}
                </button>
              ))}
            </div>
          </Section>

          {/* Agent 审批策略 */}
          <Section title="Agent 审批策略">
            <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
              {(['auto', 'edits', 'strict'] as ApprovalMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setApprovalMode(m)}
                  aria-pressed={agentPolicy?.mode === m}
                  style={{
                    ...chip,
                    background: agentPolicy?.mode === m ? 'var(--accent-soft, var(--bg))' : 'var(--bg)',
                    borderColor: agentPolicy?.mode === m ? 'var(--accent)' : 'var(--border)',
                    color: agentPolicy?.mode === m ? 'var(--accent)' : 'var(--fg-muted)',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', marginBottom: 8 }}>
              {agentPolicy ? MODE_DESC[agentPolicy.mode] : '读取中…'}
            </div>

            {agentPolicy && agentPolicy.alwaysAllow.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', marginBottom: 4 }}>
                  已记住的免审批项（共 {agentPolicy.alwaysAllow.length}）
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {agentPolicy.alwaysAllow.slice(0, 12).map((k) => (
                    <button
                      key={k}
                      onClick={() => clearAlwaysAllow(k)}
                      title="点击撤销"
                      style={{ ...chip, fontSize: 'var(--text-2xs)', padding: '2px 7px' }}
                    >
                      {k} ✕
                    </button>
                  ))}
                  <button onClick={() => clearAlwaysAllow()} style={{ ...chip, fontSize: 'var(--text-2xs)', padding: '2px 7px', color: 'var(--error)' }}>
                    全部清空
                  </button>
                </div>
              </div>
            )}

            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', marginBottom: 4 }}>
              已加载工具 {tools.length} 个（内置 {tools.filter((t) => t.source === 'builtin').length} · MCP{' '}
              {tools.filter((t) => t.source === 'mcp').length}）
            </div>
            <div style={{ maxHeight: 96, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {tools.map((t) => (
                <span
                  key={t.name}
                  title={t.description}
                  style={{
                    fontSize: 'var(--text-2xs)', padding: '2px 6px', borderRadius: 'var(--radius-sm)',
                    background: t.source === 'mcp' ? 'var(--accent-soft, var(--bg))' : 'var(--bg)',
                    border: '1px solid var(--border)',
                    color: t.source === 'mcp' ? 'var(--accent)' : 'var(--fg-muted)',
                  }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          </Section>

          {/* 访问令牌 */}
          <Section title="访问令牌" defaultOpen={false}>
            <div style={{ display: 'flex', gap: 5 }}>
              <input
                type="text"
                value={token}
                readOnly
                aria-label="访问令牌"
                style={{ ...inp, flex: 1 }}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(token).then(
                    () => showToast('令牌已复制', 'ok'),
                    () => showToast('复制失败，请手动选择', 'error'),
                  );
                }}
                style={chip}
                aria-label="复制访问令牌"
              >
                复制
              </button>
            </div>
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', marginTop: 4 }}>
              默认仅监听本机。若要局域网访问（POCKETD_HOST=0.0.0.0），需用此令牌换取会话：
              <code style={{ fontFamily: 'var(--font-mono)' }}> http://&lt;IP&gt;:3030/?token=&lt;令牌&gt;</code>
            </div>
          </Section>

          {/* MCP 服务器 */}
          <Section title="MCP 服务器" defaultOpen={false}>
            <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
              {(['http', 'stdio'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setMcpType(t)}
                  aria-pressed={mcpType === t}
                  style={{
                    ...chip,
                    background: mcpType === t ? 'var(--accent-soft, var(--bg))' : 'var(--bg)',
                    borderColor: mcpType === t ? 'var(--accent)' : 'var(--border)',
                    color: mcpType === t ? 'var(--accent)' : 'var(--fg-muted)',
                  }}
                >
                  {t === 'http' ? 'HTTP 远程' : 'stdio 本地'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
              <input
                type="text"
                placeholder="名称"
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                style={{ ...inp, flex: 1 }}
                aria-label="MCP 服务器名称"
              />
              <input
                type="text"
                placeholder={mcpType === 'http' ? 'URL (http://...)' : '命令 (node / npx)'}
                value={mcpValue}
                onChange={(e) => setMcpValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddMcp()}
                style={{ ...inp, flex: 2 }}
                aria-label={mcpType === 'http' ? 'MCP 服务器 URL' : 'MCP 启动命令'}
              />
            </div>
            {mcpType === 'stdio' && (
              <input
                type="text"
                placeholder="参数，空格分隔（如 /path/to/server.js）"
                value={mcpArgs}
                onChange={(e) => setMcpArgs(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddMcp()}
                style={{ ...inp, marginBottom: 6 }}
                aria-label="MCP 启动参数"
              />
            )}
            <button onClick={handleAddMcp} style={{ ...chip, marginBottom: 8 }} aria-label="添加 MCP 服务器">
              + 添加并连接
            </button>
            {mcpServers.length === 0 ? (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-dim)', padding: '4px 0' }}>尚未配置 MCP 服务器</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {mcpServers.map((s) => (
                  <div key={s.name} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 8px', borderRadius: 'var(--radius-sm)',
                    background: "var(--bg)", border: "1px solid var(--border)",
                    minHeight: 32,
                  }}>
                    <button
                      type="button"
                      onClick={() => toggleMcpServer(s.name)}
                      aria-label={`${s.enabled ? '禁用' : '启用'} ${s.name}`}
                      title={s.enabled ? '点击禁用' : '点击启用'}
                      style={{
                        width: 44, height: 44, flexShrink: 0, background: 'transparent',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        border: 'none', cursor: 'pointer', marginLeft: -14, marginRight: -14,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 14, height: 14, borderRadius: '50%',
                          background: s.enabled ? 'var(--success)' : 'var(--border)',
                          display: 'block',
                        }}
                      />
                    </button>
                    <span style={{ fontSize: 'var(--text-sm)' }}>{s.name}</span>
                    <span style={{
                      fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 'var(--radius-xs)',
                      background: 'var(--bg-alt)', border: '1px solid var(--border)', color: 'var(--fg-dim)',
                    }}>{s.type}</span>
                    <span style={{
                      fontSize: 'var(--text-2xs)', color: "var(--fg-dim)", flex: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{s.type === 'http' ? s.url : `${s.command} ${(s.args || []).join(' ')}`}</span>
                    <span style={{ fontSize: 'var(--text-2xs)', color: s.toolCount > 0 ? 'var(--success)' : 'var(--fg-dim)' }}>
                      {s.toolCount} 工具
                    </span>
                    <button
                      onClick={() => removeMcpServer(s.name)}
                      aria-label={`删除 ${s.name}`}
                      style={{ background: 'transparent', border: 'none', color: "var(--error)", fontSize: 'var(--text-sm)', cursor: 'pointer', padding: '2px 4px' }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div style={foot} role="toolbar" aria-label="设置操作">
          <button onClick={handleExport} style={footBtn} aria-label="导出配置到文件">导出</button>
          <button onClick={handleImport} style={footBtn} aria-label="从文件导入配置">导入</button>
          <button onClick={() => setSettings(false)} style={footBtn} aria-label="取消并关闭">取消</button>
          <button
            onClick={() => { setBase('https://api.openai.com/v1'); setKey(''); setModel('gpt-4o'); setTemp('0.7'); }}
            style={footBtn}
            aria-label="重置为默认值"
          >
            重置
          </button>
          <button onClick={handleSave} style={{ ...footBtn, background: "var(--accent)", color: 'var(--fg-on-accent)', borderColor: "var(--accent)" }} aria-label="保存设置">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/** 设置分组：不常用的几组折起来，把纵向位置留给主要设置 */
function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <button
        type="button"
        className="collapse-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="caret" aria-hidden="true">▶</span>
        <span style={{ flex: 1 }}>{title}</span>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', fontWeight: 400 }}>
          {open ? '收起' : '展开'}
        </span>
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: "var(--overlay, rgba(0,0,0,0.6))",
  display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, backdropFilter: 'blur(2px)',
};
const card: React.CSSProperties = {
  background: "var(--bg-alt)", border: "1px solid var(--border)", borderRadius: 'var(--radius-lg)',
  width: 540, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
  boxShadow: "var(--shadow)",
};
const head: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: "1px solid var(--border)",
};
const xBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: "var(--fg-dim)", cursor: 'pointer', fontSize: 'var(--text-xl)', padding: '4px 8px',
};
const foot: React.CSSProperties = {
  padding: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 8,
  justifyContent: 'flex-end', background: "var(--bg-overlay)", borderRadius: '0 0 10px 10px',
};
const footBtn: React.CSSProperties = {
  padding: '6px 16px', borderRadius: 'var(--radius-sm)', border: "1px solid var(--border)", fontSize: 'var(--text-sm)',
  background: 'transparent', color: "var(--fg)", cursor: 'pointer',
};
const lbl: React.CSSProperties = { display: 'block', fontSize: 'var(--text-xs)', color: "var(--fg-muted)", marginBottom: 5 };
const inp: React.CSSProperties = {
  width: '100%', background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border)",
  borderRadius: 'var(--radius-sm)', padding: '7px 9px', fontFamily: "var(--font-mono)", fontSize: 'var(--text-sm)', outline: 'none',
};
const chip: React.CSSProperties = {
  fontSize: 'var(--text-xs)', background: "var(--bg)", border: "1px solid var(--border)", color: "var(--fg-muted)",
  padding: '4px 10px', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
};
const testBtn: React.CSSProperties = {
  fontSize: 'var(--text-xs)', background: "var(--bg)", border: "1px solid var(--border)", color: "var(--accent)",
  padding: '4px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
};
const spin: React.CSSProperties = {
  width: 12, height: 12, border: '2px solid var(--border)', borderTopColor: "var(--accent)", borderRadius: '50%', animation: 'spin .6s linear infinite',
};
