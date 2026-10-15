# Contributing to pocketd

English | [中文](#为-pocketd-做贡献)

Thank you for your interest in contributing! This project aims to bring a full-featured mobile development environment to Android via Termux.

## Development Setup

### Prerequisites

- Node.js >= 24.15 (required by the jsdom 30 used in the frontend test suite)
- npm >= 10
- (Optional) Termux on Android for on-device testing

### Getting Started

```bash
# Clone the repository
git clone https://github.com/badhope/pocketd.git
cd pocketd

# Install server dependencies
npm install

# Install and build the frontend
cd ui
npm install
npm run build
cd ..

# Start the development server
npm start
```

Then open `http://localhost:3030` in your browser.

### Frontend Development (HMR)

For hot module replacement during UI development:

```bash
# Terminal 1: Start backend
npx tsx server.ts

# Terminal 2: Start Vite dev server
cd ui && npm run dev
# Opens http://localhost:5173 with API proxy to :3030
```

## Code Style

- TypeScript strict mode enabled
- CSS via CSS custom properties (`var(--*)`) — no CSS frameworks
- Component styling with inline `style={}` + shared `S` style objects
- Functional components + hooks (no class components)
- Zustand for state management (in `ui/src/store.ts`)

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full technical documentation.

## Pull Request Guidelines

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Ensure `npx tsc --noEmit` passes with zero errors
4. Ensure `npm run build` produces a working `ui/dist/`
5. Write clear commit messages in English
6. Open a pull request with a clear description of changes

## Reporting Issues

- Use GitHub Issues
- Describe the environment (Termux, Android version, Node.js version)
- Include steps to actual and expected behavior
- Screenshots or logs are helpful

---

# 为 pocketd 做贡献

[English](#contributing-to-pocketd) | 中文

感谢你的关注！本项目旨在通过 Termux 把完整功能的移动开发环境带到安卓。

## 开发环境准备

### 依赖

- Node.js >= 24.15 (required by the jsdom 30 used in the frontend test suite)
- npm >= 10
- (可选) Termux 用于在安卓机上测试

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/badhope/pocketd.git
cd pocketd

# 安装服务端依赖
npm install

# 安装并构建前端
cd ui
npm install
npm run build
cd ..

# 启动开发服务器
npm start
```

浏览器打开 `http://localhost:3030` 即可使用。

### 前端开发（热更新）

UI 开发时推荐使用双进程模式以获得最佳体验：

```bash
# 终端 1: 启动后端
npx tsx server.ts

# 终端 2: 启动 Vite 开发服务器
cd ui && npm run dev
# 浏览器打开 http://localhost:5173，API 自动代理到 :3030
```

## 代码风格

- TypeScript 启用 strict 模式
- CSS 使用 CSS 自定义属性（`var(--*)`）— 不使用 CSS 框架
- 组件样式采用 inline `style={}` + 共享 `S` 样式对象
- 函数式组件 + hooks（不使用 class 组件）
- Zustand 状态管理（集中在 `ui/src/store.ts`）

## 技术架构

完整技术文档见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Pull Request 指南

1. Fork 仓库
2. 创立功能分支 (`git checkout -b feature/amazing-feature`)
3. 确保 `npx tsc --noEmit` 零错误通过
4. 确保 `npm run build` 生成可用的 `ui/dist/`
5. 使用英文写清晰的 commit message
6. 发起 PR 并用描述清楚变更内容

## Bug 反馈

- 使用 GitHub Issues
- 注明环境（Termux、Android 版本、Node.js 版本）
- 给出复现步骤、实际与预期行为
- 截图或日志会很有帮助
