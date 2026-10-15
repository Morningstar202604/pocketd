import { useStore } from '../store';
import { EmptyState } from './StateView';

export function StatsPanel() {
  const { usage, sessions, curSession, apiConfig } = useStore();

  // 上下文体积按字符数估算（含多模态消息里的文本 part）
  const sessionMessages = sessions[curSession]?.messages ?? [];
  const currentSessionChars = sessionMessages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    if (Array.isArray(m.content)) {
      return (
        sum +
        m.content.reduce((acc: number, part: unknown) => {
          const p = part as { type?: string; text?: string };
          return p?.type === 'text' && typeof p.text === 'string' ? acc + p.text.length : acc;
        }, 0)
      );
    }
    return sum;
  }, 0);

  // 近 7 天（含今天）
  const last7 = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = usage.history.find((h) => h.date === key);
    last7.push({
      date: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      calls: found?.calls || 0,
      tokens: found?.tokens || 0,
    });
  }
  const maxTokens = Math.max(...last7.map((d) => d.tokens), 1);
  const weekTotal = last7.reduce((s, d) => s + d.tokens, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <section style={sectionStyle}>
        <h3 style={headingStyle}>当前会话</h3>
        <div style={{ display: 'flex', gap: 14 }}>
          <StatItem label="消息数" value={String(sessionMessages.length)} />
          <StatItem label="上下文" value={formatCount(currentSessionChars)} hint="字符" />
          <StatItem label="模型" value={apiConfig.apiModel.slice(0, 12)} />
        </div>
      </section>

      <section style={{ ...sectionStyle, borderTop: '1px solid var(--border)' }}>
        <h3 style={headingStyle}>用量</h3>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <StatItem label="今日调用" value={String(usage.todayCalls)} />
          <StatItem label="今日 Token" value={formatCount(usage.todayTokens)} />
          <StatItem label="近 7 天" value={formatCount(weekTotal)} />
          <StatItem label="累计 Token" value={formatCount(usage.totalTokens)} />
        </div>
        {usage.lastCompletionTokens > 0 && (
          <div
            style={{
              marginTop: 10, fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            最近一次 ↑{usage.lastPromptTokens} / ↓{usage.lastCompletionTokens}
            {usage.lastPromptTokens > 0 && ` · ${Math.round((usage.lastPromptTokens / (usage.lastPromptTokens + usage.lastCompletionTokens)) * 100)}% 输入占比`}
          </div>
        )}
      </section>

      <section style={{ ...sectionStyle, borderTop: '1px solid var(--border)', flex: 1 }}>
        <h3 style={headingStyle}>7 天趋势</h3>
        {weekTotal === 0 ? (
          <EmptyState icon="📊" title="还没有用量记录" description="发起一次对话后这里会出现每日统计" compact />
        ) : (
          <div
            role="img"
            aria-label={`近 7 天 Token 用量：${last7.map((d) => `${d.label} ${d.tokens}`).join('，')}`}
            style={{ display: 'flex', gap: 5, alignItems: 'flex-end', height: 110 }}
          >
            {last7.map((d) => (
              <div
                key={d.date}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}
              >
                <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                  <div
                    title={`${d.date}：${d.calls} 次调用 / ${d.tokens} tokens`}
                    style={{
                      width: '100%',
                      height: `${Math.max(3, (d.tokens / maxTokens) * 100)}%`,
                      background: d.tokens > 0 ? 'var(--accent)' : 'var(--border)',
                      borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0',
                      transition: 'height .2s',
                    }}
                  />
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', marginTop: 5 }}>
                  {d.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ ...sectionStyle, borderTop: '1px solid var(--border)' }}>
        <h3 style={headingStyle}>调用历史</h3>
        {usage.history.length === 0 ? (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-dim)', padding: '8px 0' }}>
            暂无调用记录
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: 'var(--text-xs)', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--fg-muted)' }}>
                <th style={{ ...thStyle, textAlign: 'left' }}>日期</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>调用</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Token</th>
              </tr>
            </thead>
            <tbody>
              {usage.history.slice(-10).reverse().map((h) => (
                <tr key={h.date} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 6px', color: 'var(--fg-muted)' }}>{h.date}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>{h.calls}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {h.tokens.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatItem({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 62 }}>
      <div
        style={{
          fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--fg)',
          lineHeight: 'var(--leading-tight)',
        }}
      >
        {value}
        {hint && (
          <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 400, color: 'var(--fg-dim)', marginLeft: 3 }}>
            {hint}
          </span>
        )}
      </div>
      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const sectionStyle: React.CSSProperties = {
  padding: '12px 14px',
  background: 'var(--bg-alt)',
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 9px',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--fg-muted)',
  letterSpacing: '.02em',
};

const thStyle: React.CSSProperties = { padding: '3px 6px', fontWeight: 500 };
