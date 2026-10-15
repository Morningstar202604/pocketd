import { memo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';

// 不引入 highlight.js 的预置主题：它的配色写死在单一色调上，
// 浅色主题下会得到深色代码块。.hljs-* 的配色在 index.css 里用 token 定义，两套主题共用。

const schema = {
  ...defaultSchema,
  clobberPrefix: '',
  tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary'],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./, 'hljs']],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^hljs-./]],
    a: [...(defaultSchema.attributes?.a ?? []), 'target', 'rel'],
  },
};

/** 从 hast 节点取纯文本：比从 React 子节点里抠可靠（高亮后子节点是层层 span） */
interface HastNode {
  type?: string;
  value?: string;
  children?: HastNode[];
}

function hastText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

/**
 * 代码块外包一层，用来放复制按钮。
 * 按钮必须放在 <pre> 之外 —— 放进 <pre> 会被当成代码内容的一部分。
 */
function CodeBlock({ raw, children }: { raw: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      {children}
      <button
        type="button"
        className="md-copy"
        onClick={() => {
          const text = raw.replace(/\n$/, '');
          navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            },
            () => setCopied(false),
          );
        }}
        aria-label={copied ? '已复制代码' : '复制代码'}
        title="复制代码"
      >
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

const components: Components = {
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children, ...props }) => (
    <div style={{ overflowX: 'auto' }}>
      <table {...props}>{children}</table>
    </div>
  ),
  // 多行代码块一定经过 pre；行内 code 不经过，所以不会误加按钮
  pre: ({ children, node, ...props }) => (
    <CodeBlock raw={hastText(node as unknown as HastNode)}>
      <pre {...props}>{children}</pre>
    </CodeBlock>
  ),
};

export interface MarkdownProps {
  content: string;
}

export const Markdown = memo(function Markdown({ content }: MarkdownProps) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeSanitize, schema],
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
