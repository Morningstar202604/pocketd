/* ── 预设配置 / 快捷提示 / 命令列表 ── */

export interface ProviderPreset {
  id: string;
  name: string;
  icon: string;
  base: string;
  model: string;
  description: string;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: '⚡',
    base: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    description: '国内性价比标杆',
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    icon: '🌙',
    base: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    description: '超长上下文 200K',
  },
  {
    id: 'groq',
    name: 'Groq',
    icon: '🚀',
    base: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    description: '极速推理·免费',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    icon: '🦙',
    base: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder',
    description: '本地运行·数据自持',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🌟',
    base: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    description: '官方 API',
  },
];

export const QUICK_PROMPTS = [
  { label: '解释代码', text: '请解释这段代码的作用和工作原理' },
  { label: '重构优化', text: '帮我重构这段代码，提高可读性和性能' },
  { label: '添加注释', text: '为这段代码添加清晰的中文注释' },
  { label: '写测试', text: '为以下代码编写单元测试' },
  { label: 'Debug', text: '帮我找出这段代码中的潜在 bug' },
  { label: 'Git 提交', text: '检查当前变更，帮我写一条清晰的 commit message' },
  { label: '文档', text: '为这个模块生成使用说明文档' },
  { label: '翻译', text: '把这段代码关键注释翻译成英文' },
];

export const COMMON_MODELS = [
  { name: 'deepseek-chat', sub: 'DeepSeek' },
  { name: 'deepseek-reasoner', sub: 'DeepSeek R1' },
  { name: 'moonshot-v1-8k', sub: 'Moonshot' },
  { name: 'gpt-4o', sub: 'OpenAI' },
  { name: 'gpt-4o-mini', sub: 'OpenAI' },
  { name: 'claude-sonnet-4-20250514', sub: 'Anthropic' },
  { name: 'llama-3.3-70b-versatile', sub: 'Groq' },
  { name: 'qwen2.5-coder:32b', sub: 'Ollama' },
  { name: 'qwen2.5-coder:14b', sub: 'Ollama' },
];

export const COMMANDS = [  { id: 'settings', label: '打开设置', icon: '⚙️', kbd: '⌘ ,' },
  { id: 'save', label: '保存文件', icon: '💾', kbd: '⌘ S' },
  { id: 'new-file', label: '新建文件', icon: '📄', kbd: '⌘ N' },
  { id: 'git-commit', label: 'Git 提交', icon: '📌', kbd: '' },
  { id: 'git-status', label: 'Git 状态', icon: '📋', kbd: '' },
  { id: 'refresh', label: '刷新文件列表', icon: '🔄', kbd: '⌘ R' },
  { id: 'terminal', label: '切换终端', icon: '⌨️', kbd: '⌘ J' },
  { id: 'git-panel', label: 'Git 面板', icon: '📂', kbd: '' },
  { id: 'clear-chat', label: '清空对话', icon: '🗑️', kbd: '' },
  { id: 'new-session', label: '新建会话', icon: '✚', kbd: '⌘ T' },
  { id: 'toggle-files', label: '切换文件树', icon: '📁', kbd: '⌘ B' },
];

// Monaco 与 xterm 的字体参数走 JS 库，不解析 CSS 变量，必须是真实字体栈
export const MONO_FONT = "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace";
