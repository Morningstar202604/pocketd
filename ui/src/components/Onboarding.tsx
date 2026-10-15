import { useState } from 'react';
import { useStore } from '../store';
import { Wordmark } from './Brand';
import { writeStored, STORAGE_KEYS } from '../lib/brand';

const STEPS = [
  {
    title: '一个会动手的编码 agent',
    content:
      'ZCode 跑在你手机上的 Termux 里。模型不只回话——它直接读写工作区文件、执行命令、搜索替换、查看 Git，还能连 MCP 服务器。所有数据留在设备上。',
  },
  {
    title: '危险操作由你批准',
    content:
      '默认策略下，改文件放行；执行命令、删除文件和调用 MCP 工具需要你点「批准」。请自行判断风险（尤其是社区或自建 MCP 服务器的可信度）。随时可在设置里切换 auto / edits / strict 三档。',
  },
  {
    title: '接上你的模型',
    content:
      'ZCode 不绑定提供商：任何兼容 OpenAI 协议的模型都行——DeepSeek、Moonshot、Groq（免费）、Ollama（本地）、OpenAI 等。填好 Key 点「测试连接」即可开始。',
  },
];

export function Onboarding() {
  const { onboardOpen, setOnboard, setSettings } = useStore();
  const [step, setStep] = useState(0);

  if (!onboardOpen) return null;

  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      setOnboard(false);
      setSettings(true);
      writeStored(STORAGE_KEYS.onboarded, '1');
    } else {
      setStep(step + 1);
    }
  };

  const handleSkip = () => {
    setOnboard(false);
    writeStored(STORAGE_KEYS.onboarded, '1');
  };

  return (
    <div
      className="scrim"
      style={{
        zIndex: 'var(--z-command)' as unknown as number,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="欢迎使用 ZCode"
    >
      <div
        style={{
          background: 'var(--bg-alt)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          width: 520,
          maxWidth: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow)',
          overflow: 'hidden',
          animation: 'slideUp .18s ease',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            padding: '28px 28px 14px',
            background: 'linear-gradient(180deg, var(--accent-soft), transparent)',
          }}
        >
          <Wordmark size={28} />
          <div style={{ fontSize: 'var(--text-base)', color: 'var(--fg-muted)', marginTop: 8 }}>
            本地优先的编码 agent
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, paddingTop: 14 }} role="list">
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                role="listitem"
                style={{
                  width: i === step ? 20 : 8,
                  height: 8,
                  borderRadius: 'var(--radius-pill)',
                  background: i === step ? 'var(--accent)' : i < step ? 'var(--success)' : 'var(--border)',
                  transition: 'width .2s, background-color .2s',
                }}
                aria-label={`步骤 ${i + 1}/${STEPS.length}${i === step ? '（当前）' : ''}`}
              />
            ))}
          </div>
        </div>

        <div style={{ padding: '4px 24px 20px', flex: 1, overflowY: 'auto' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 'var(--text-lg)', fontWeight: 600 }}>
            {STEPS[step].title}
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--text-base)',
              color: 'var(--fg-muted)',
              lineHeight: 'var(--leading-relaxed)',
            }}
          >
            {STEPS[step].content}
          </p>
        </div>

        <div
          style={{
            padding: 14,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <button
            type="button"
            className="btn"
            onClick={handleSkip}
            aria-label="跳过引导，稍后再配置"
            style={{ border: 'none', background: 'transparent', color: 'var(--fg-muted)' }}
          >
            稍后再说
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {step > 0 && (
              <button type="button" className="btn" onClick={() => setStep(step - 1)} aria-label="返回上一步">
                上一步
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={handleNext}
              aria-label={isLast ? '打开设置面板完成配置' : '进入下一步'}
            >
              {isLast ? '开始配置 →' : '下一步 →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
