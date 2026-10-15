import { useStore } from '../store';
import { Markdown } from './Markdown';
import { EmptyState, ErrorState, LoadingState } from './StateView';

export function KnowledgePanel() {
  const { knowledgeDoc, knowledgeLoading, knowledgeError, generateKnowledge, regenerateKnowledge } = useStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-alt)', flexShrink: 0,
      }}>
        <span style={{ flex: 1, fontSize: 'var(--text-xs)', fontWeight: 600 }}>📚 项目知识库</span>
        {knowledgeDoc && (
          <button
            type="button"
            className="btn-xs"
            onClick={regenerateKnowledge}
            disabled={knowledgeLoading}
            aria-label="重新生成知识库"
          >
            <span aria-hidden="true">↻</span> {knowledgeLoading ? '生成中' : '重新生成'}
          </button>
        )}
        {!knowledgeDoc && (
          <button
            type="button"
            className="btn-primary"
            onClick={generateKnowledge}
            disabled={knowledgeLoading}
            aria-label="生成项目知识库"
          >
            {knowledgeLoading ? '生成中' : '✨ 立即生成'}
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {knowledgeLoading && !knowledgeDoc ? (
          <LoadingState label="正在分析项目结构、依赖与 Git 历史" />
        ) : knowledgeError ? (
          <ErrorState
            title="知识库生成失败"
            message={knowledgeError}
            onRetry={generateKnowledge}
          />
        ) : knowledgeDoc ? (
          <Markdown content={knowledgeDoc} />
        ) : (
          <EmptyState
            icon="📚"
            title="项目知识库"
            description="扫描项目结构、依赖清单、README 与 Git 历史，生成一份可直接交给模型的 Markdown 文档。内容全部在本地读取。"
            action={
              <button type="button" className="btn-primary" onClick={generateKnowledge}>
                ✨ 立即生成
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}
