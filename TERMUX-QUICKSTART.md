# Termux 快速上手

## 一键安装并启动

```bash
# 1. Termux 安装依赖
pkg update -y
pkg install -y nodejs-lts git python make clang pkg-config

# 2. 切到项目目录
cd ~/android-dev

# 3. 一键安装 + 构建 + 启动
chmod +x termux-setup.sh && ./termux-setup.sh
```

## 在手机浏览器访问

启动成功后会打印访问地址：

```
pocketd Local Development Server
  Workspace:  /data/data/com.termux/files/home/.pocketd/workspace
  URL:        http://localhost:3030
  API Model:  gpt-4o @ https://api.openai.com/v1
```

在手机浏览器（Chrome/Safari）打开：`http://localhost:3030`

> 如果是其它设备访问，使用 `http://<手机IP>:3030`，可在 Termux 里 `ifconfig` 查看 ip

## 配置 AI 对话

1. 浏览器打开后点击右上角 ⚙️ **设置**
2. 选择提供商预设（DeepSeek / Moonshot / Groq 等）
3. 填入 API Key
4. 点 **测试连接** 确认 OK
5. 保存 → 切换到"对话"标签开始聊天

## 功能说明

### 5 个底部 Tab
- 💬 **对话** — AI 流式对话、多会话、快捷指令、附件上传
- ⌨️ **终端** — 完整 bash/zshell，通过 node-pty 直连
- 📋 **Git** — 分支可视化、切分支、新建/删除、status/diff/log/add/commit
- 📊 **监控** — 会话上下文、今日调用、7天趋势图
- 📚 **知识库** — 分析项目结构，生成完整 Markdown 文档

### 顶栏按钮
- 📁 文件管理器（移动端 toggle）
- ＋ 新建文件
- 💾 保存 (Ctrl+S)
- ✚ 新建会话
- ⌘ 命令面板 (Ctrl+K)
- 状态绿点
- 模型切换芯片
- ☀️/🌙 深浅主题切换
- ⚙️ 设置

### 快捷键
| 快捷键 | 功能 |
|--------|------|
| `Ctrl+S` | 保存当前文件 |
| `Ctrl+K` | 打开命令面板 |
| `Enter` | 发送消息 |
| `Shift+Enter` | 换行 |

### 特色功能
- **思考过程**：DeepSeek R1 等推理模型会展开显示思考链
- **附件**：Ctrl+V 粘贴图片、点 📎 选文件、拖进输入框
- **MCP**：Settings → MCP 服务器，填入名称和 URL 后服务端代理

## 工作目录

默认 `~/.pocketd/workspace`，可初始化为 git 仓库：

```bash
cd ~/.pocketd/workspace
git init
# 从这里开始开发
```

## 停止服务

`Ctrl+C` 停止。再次启动：`npx tsx server.ts`

## 常见问题

- **白屏** → 前端未构建：`cd ui && npm run build`
- **node-pty 缺失** → 终端不可用，不影响其他功能；若要修复需 `pkg install clang make`
- **API 失败** → 检查 Base URL 末尾不要带 `/`，Key 是否正确
- **端口冲突** → `POCKETD_PORT=4000 npx tsx server.ts` 改用 4000 端口
