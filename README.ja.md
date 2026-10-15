# pocketd — Android スマートフォンを本当に働くコーディングエージェントに

<div align="center">

**[[English](README.md) | [中文](README.zh-CN.md) | 日本語]**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 24](https://img.shields.io/badge/node-%3E%3D%2024-brightgreen.svg)](https://nodejs.org)
[![TypeScript 7](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://www.typescriptlang.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![Tests](https://img.shields.io/badge/tests-139%20passing-brightgreen.svg)](#開発)

*スマートフォン上でローカルに動くコーディングエージェント — 本物のツール、本物のファイル、承認はあなたが*

[クイックスタート](#クイックスタート) · [機能一覧](#機能一覧) · [HTTP API](#http-api) · [アーキテクチャ](docs/ARCHITECTURE.md) · [設計判断](docs/adr/) · [モバイル向けメモ](docs/MOBILE.md) · [コントリビュート](CONTRIBUTING.md)

</div>

---

## これは何か

`pocketd` は、Android スマートフォン上の [**Termux**](https://termux.dev) の中で動作し、ブラウザから操作できる、自己完結型・ローカルファーストの**コーディングエージェント**です。

チャットのラッパーではありません。モデルは**本物のツール**を手にします — ファイルの読み書き、正確な編集、検索と置換、シェルコマンドの実行、Git 状態の確認、MCP サーバーの呼び出し — そしてそのすべてが、あなたが設定した**承認ポリシー**のもとでワークスペースに対して動作します。**クラウドアカウント不要、OAuth 不要、テレメトリ一切なし。** データはすべて端末内に留まります。AI 機能はあなた自身の API キーで動き、OpenAI 互換のプロバイダーならどれでも使えます（DeepSeek、Moonshot、Groq、Ollama、OpenAI など）。

### スマートフォンで実際に何に使うのか

まず**そうではないもの**を明確にします。6 インチの画面でゼロから機能を書き始める場所ではありません。物理キーボードもマルチウィンドウもなく、その用途ではノート PC が桁違いに優れています。本当に成立するのは次の場面です。

| 場面 | スマートフォンの方が適している理由 |
|---|---|
| **エージェントに指示して、ポケットにしまう** | 「認証の失敗しているテストを直して」と言い、画面をロックして離れ、戻ってきたら diff か結果を確認する。**これが主要な用途**であり、実行が接続より長生きする理由です |
| **移動中の外科的な小さな修正** | バージョン番号の更新、誤字の修正、設定の調整、壊れたコミットの revert — 小さく、範囲が明確で、検証できる |
| **読む** | 通勤中に diff を読む、慣れないコードを素早く把握する |
| **サーバーへの端末として使う** | Termux と踏み台サーバー。ターミナルタブがこれを担います |

そこから二つの厳しい制約が導かれ、どちらも実装に現れています。

1. **チャットはホーム画面であり、六つのタブの一つではない。** 狭い画面ではアプリはチャットパネルに着地し、エディタは「タップして移動する先」であって、その逆ではありません。
2. **タブが開いたままであることを前提にしてはいけない。** 画面のロック、アプリの切り替え、Android によるバックグラウンドタブの回収は、スマートフォンでは**例外ではなく日常**です。だからこそ、サーバー側が所有する実行、15 分の承認ウィンドウ、ページを開き直したときの自動再接続があるのです。

### 率直に言えば：ランタイムの限界

APK がなければフォアグラウンドサービスもなく、信頼できる通知もありません。`node-pty` は端末上でのコンパイルが必要で（clang/make、一部の ABI では失敗します）、Android のバッテリー最適化は Termux を停止させます。**「通知してくれないエージェントは、睨み続けなければならない Web ページと同じだ」** — この制約はこの形態では根本的に解消できず、緩和することしかできません。そこで、この制約内で信頼できるようにできるものはすべて実装しました。クライアントから切り離された実行、十分に長い承認ウィンドウ、自動再接続、サーバー側に保存される履歴です。

---

## 機能一覧

| モジュール | 機能 |
|--------|----------|
| **エージェント** | 組み込みツール 11 種 · 多段ツールループ（最大 40 ステップ）· ツール呼び出しの可視化 · 三つの承認モード · ハード拒否リスト · 「この選択を記憶」で以後の確認を省略 |
| **耐障害性** | **ページを閉じても画面をロックしても実行は中断しない**（実行はサーバーが所有）· 開き直すと再接続して履歴を再生 · 承認ウィンドウ 15 分 · ストリーム切断時の明示的な「再接続」導線 |
| **承認** | `bash`・削除・MCP ツールは既定で承認が必要 · 危険度の段階 · 引数のプレビュー · タイムアウトは拒否として扱う（fail closed）· 無効になったカードは明示 |
| **MCP** | 公式 SDK · **HTTP と stdio の両トランスポート** · ツールの自動検出と登録 · プロバイダーの命名規則への正規化 · 設定画面から追加・有効化・無効化 |
| **エディタ** | Monaco Editor · 複数タブ · シンタックスハイライト · `Ctrl+S` で保存 · タッチ向けに調整 |
| **ファイル** | ディレクトリ移動 · あいまい絞り込み · 新規作成 · ゴミ箱への削除（**元のパスに復元可能**）· ドラッグ＆ドロップでアップロード · 無視対象を淡色表示 · 隠しファイルの表示切り替え |
| **無視ルール** | `.gitignore` を**リアルタイムに読む**（コピーを持たないので古くならない）· `.pocketdignore` を追加で適用 · 旧 `.zcodeignore` も引き続き有効 · `node_modules` などを再帰的に走査しない · `include_ignored` で明示的に無効化 |
| **ターミナル** | xterm.js · node-pty · 本物の bash/zsh · WebSocket ストリーミング |
| **チャット** | SSE ストリーミング · ツール呼び出しカード · 承認カード · 複数セッション（**サーバー同期・ワンタップ復元**）· スラッシュコマンド · 添付（貼り付け／ドラッグ／カメラ）· 画像入力 · 思考過程の表示 |
| **コンテキスト** | 自動的な上限管理：直近 12 ターンは原文のまま保持し、古いツール通信は縮退。切り詰めは明示され、メッセージ列が不正になることはない |
| **プレビュー** | **画像をそのまま表示**（「バイナリファイル」エラーはもう出ない）· Markdown プレビュー · HTML をサンドボックス iframe でプレビュー · **ワークスペースを静的サイトとして閲覧**（`/preview/`、ディレクトリ索引、相対アセットが解決される）· 任意のファイルを「新しいタブで開く」 |
| **ストリーミング UX** | カーソルが出力を追う · **スクロール位置を奪わない**（代わりに「最下部へ」を提示）· 実行中のツール呼び出しが呼吸するように表示 · コードブロックとメッセージのワンクリックコピー |
| **Git** | ブランチグラフ（ahead/behind）· diff/log/add/commit · merge · push/pull/fetch · checkout/branch/remote |
| **検索** | 構造化された `path:line:col` の結果 · クロスプラットフォーム（grep バイナリに依存しない）· 行へジャンプ |
| **置換** | コミット前にプレビュー · 変更ファイルと一致件数の一覧 · 正規表現とリテラルのセマンティクスが一致 |
| **ナレッジベース** | プロジェクト構造を走査してリッチな Markdown 文書を生成。チャットと同じレンダラーで描画 |
| **統計** | 実際のトークン使用量 · 7 日間のトレンドグラフ · 呼び出し履歴 |
| **セキュリティ** | 既定ではループバックのみ待ち受け · 非ループバックにはアクセストークンを強制 · パスサンドボックス（シンボリックリンク対策を含む） |
| **設定** | プロバイダーのプリセット 5 種 · 承認モードの切り替え · ツール一覧 · アクセストークン · MCP 管理 |
| **デザインシステム** | 8 段階の文字サイズ · すべてのコントラスト比が WCAG AA を満たす（実測値をトークンの隣に記録）· ライト／ダーク両テーマが完全（Monaco、xterm、シンタックスハイライトを含む）· 44px のタッチターゲット |
| **ブランド** | 幾何学的な小文字 d のマーク（コンポーネントと favicon が同一のジオメトリを共有し、テストで保護）· maskable セーフゾーン付き PNG アイコン · apple-touch-icon · OG/Twitter メタデータ · 動的な `theme-color` |
| **テーマ／モバイル** | ダーク／ライトの CSS 変数 · 下部 5 タブナビゲーション · セーフエリア · ARIA · タッチ端末では ⌘/Ctrl のヒントを表示しない |
| **オンボーディング** | 3 ステップの初回起動ウィザード |

---

## クイックスタート

### Android（Termux）

```bash
# 1. システム依存パッケージ
pkg update -y
pkg install -y nodejs git python make clang pkg-config

# 2. クローン
git clone https://github.com/badhope/pocketd.git
cd pocketd

# 3. インストール・ビルド・起動を一度に
chmod +x termux-setup.sh && ./termux-setup.sh
```

スクリプトは依存関係のインストール、フロントエンドのビルド、`~/.pocketd/env` の書き出しを行い、その後**フォアグラウンドでサーバーを起動します**（Ctrl+C で停止）。

Android 版 Chrome で `http://localhost:3030` を開き、メニューから **ホーム画面に追加** を選ぶと、単独ウィンドウの PWA になります（アドレスバーなし、専用アイコン、ダークテーマ）。`pocketd` に APK はありません。Node ランタイムは Capacitor のような WebView シェルの中には入りませんし、エディタ・ターミナル・Git はすべて Termux 内のこのプロセスが提供します。

バックグラウンドで動かし続けるには：

```bash
termux-wake-lock           # システムによる回収を防ぐ
nohup npm start > ~/.pocketd/server.log 2>&1 &
```

### macOS / Linux / Windows

**Node ≥ 24.15** が必要です（`node -v` で確認）。フロントエンドのテストは jsdom 30 を使っており、これが 24.15 以上を要求します。古い 24.x でもサーバー自体は動きますが、`npm run test:ui` はエンジン条件を満たさず制限されます。

```bash
git clone https://github.com/badhope/pocketd.git
cd pocketd
npm install
cd ui && npm install && npm run build && cd ..
npm start
```

その後 `http://localhost:3030` を開きます。

> 設定は `~/.pocketd/env` から読み込まれ、ブラウザの設定画面から直接入力することもできます。[設定を参照](#設定)。

---

## 設定

AI 機能には API キーが必要です。OpenAI 互換のプロバイダーならどれでも使えます（OpenAI、DeepSeek、Moonshot、Groq、Ollama など）。

### 環境変数（`~/.pocketd/env`）

```bash
export POCKETD_API_KEY="sk-xxx"
export POCKETD_API_BASE="https://api.deepseek.com/v1"
export POCKETD_API_MODEL="deepseek-chat"
export POCKETD_WORKSPACE="$HOME/.pocketd/workspace"
export POCKETD_PORT="3030"
export POCKETD_HOST="127.0.0.1"        # 0.0.0.0 にするとアクセストークン認証が強制される
export POCKETD_APPROVAL_MODE="edits"   # auto | edits | strict
export POCKETD_SHELL=""                # 省略可。コマンド実行に使うシェルを上書き
```

旧来の `ZCODE_*` 名も引き続き読まれるため、既存の設定はそのまま動きます。

### 承認モード

| モード | 挙動 |
|------|-----------|
| `auto` | 一切確認しない。ただしハード拒否リストは有効（`rm -rf /`、`mkfs`、`dd of=/dev/sd*`、フォーク爆弾などは常に遮断され、承認もできない） |
| `edits`（既定） | ファイル変更は通過。コマンド実行・ファイル削除・MCP ツールは承認が必要 |
| `strict` | 読み取り専用ツール（ファイル読み込み／一覧／検索／Git 参照）以外はすべて承認が必要 |

モードは設定画面で切り替えるか、チャットで `/approve auto|edits|strict` を送ります。承認時に「この選択を記憶」にチェックを入れると、そのコマンドの先頭語またはディレクトリが許可リストに追加され、設定画面からワンクリックで取り消せます。

### 設定画面

右上の ⚙️ **設定** を開きます：API キーを入力 → **接続をテスト**。その下で承認モードの切り替え、読み込まれているツール一覧の確認、アクセストークンのコピー、MCP サーバーの追加・削除（**HTTP リモート** または **stdio ローカル**）ができます。

| プロバイダー | Base URL | 推奨モデル |
|----------|----------|-----------------|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| Groq（無料枠） | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama（ローカル） | `http://localhost:11434/v1` | `qwen2.5-coder` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |

### MCP サーバー

```jsonc
// HTTP リモート
{ "name": "github", "type": "http", "url": "https://example.com/mcp" }

// stdio ローカル（cwd はワークスペース）
{ "name": "my-tool", "type": "stdio", "command": "node", "args": ["/path/to/server.js"] }
```

設定は `~/.pocketd/state/mcp.json` に保存され、起動時に自動的に再接続します。モデルからはツールが `mcp__<サーバー>__<ツール>` として見えます（プロバイダーの関数名規則に正規化済み）。

---

## HTTP API

| エンドポイント | メソッド | 説明 |
|----------|--------|-------------|
| `/` | GET | SPA のエントリーポイント |
| `/assets/*` | GET | 静的 JS/CSS |
| `/api/status` | GET | サーバー状態：ワークスペース、モデル、読み込み済みツール、MCP 接続 |
| `/api/auth/token` | GET | アクセストークンを読む（**ループバックのみ**） |
| `/api/config` | GET / POST | API 設定の表示／保存 |
| `/api/config/test` | POST | サーバー側から上流への接続テスト（ブラウザの CORS を回避） |
| `/api/files` | GET | `?path=.` でディレクトリを一覧 |
| `/api/file` | GET / POST / PUT / DELETE | ファイルの読み／書き／作成／削除 |
| `/api/trash` | GET | ゴミ箱の項目一覧（元のパスと削除時刻を含む） |
| `/api/file/raw` | GET | 生のバイト列（画像・バイナリのプレビュー、ダウンロード） |
| `/preview/*` | GET | **ワークスペースを静的サイトとして配信**：ファイルはそのまま、ディレクトリには索引ページ。同じパスサンドボックスで、逸脱は拒否 |
| `/api/trash/restore` | POST | ファイルを元のパスに復元 |
| `/api/search` | GET | 構造化検索（`?q=`, `?regex=1`, `?case=1`, `?ext=`） |
| `/api/replace` | POST | ファイル横断の置換（`dryRun` を推奨、コミット前にプレビュー） |
| `/api/agent/sessions` | GET | セッション一覧 |
| `/api/agent/sessions/:id` | GET / PUT / DELETE | セッションの読み／上書き／削除 |
| `/api/agent/tools` | GET | 現在利用可能なツール（組み込み + MCP） |
| `/api/agent/policy` | GET / POST | 承認ポリシーの読み／切り替え |
| `/api/agent/policy/always-allow` | DELETE | 記憶された承認を取り消す |
| `/api/agent/approval` | POST | 保留中のツール呼び出しの承認に応答 |
| `/api/git/*` | — | init / status / add / commit / log / diff / branches / checkout / branch / merge / push / pull / fetch / remotes |
| `/api/mcp/servers` | GET / POST / DELETE | MCP サーバー管理（POST は http と stdio に対応） |
| `/api/mcp/servers/:name/toggle` | POST | MCP サーバーの有効化／無効化 |
| `/api/mcp/reload` | POST | MCP 接続を再初期化 |
| `/api/knowledge/generate` | GET | ナレッジ文書を生成 |
| `/api/chat/stream` | POST | エージェント実行を開始（レスポンスに `x-pocketd-run-id`）。SSE イベントは下記 |
| `/api/agent/runs` | GET | 最近の実行一覧（まだ進行中のタスクを見つけるため） |
| `/api/agent/runs/:id` | GET | 実行状態とイベントの再生（`?from=N`） |
| `/api/agent/runs/:id/stream` | GET | **再接続**：`?from=N` 以降のイベントを再生してからライブに移行 |
| `/api/agent/runs/:id/cancel` | POST | 実行をキャンセル（**実行**であり接続ではない） |

### SSE イベント契約

| イベント | 意味 |
|---|---|
| `run-start` | 実行開始。利用可能なツール一覧を伴う |
| `step` | 上流との 1 往復 |
| `message` / `thinking` | テキスト差分 / 推論差分 |
| `tool-call` / `tool-result` | ツール呼び出しとその結果（`isError` を含む） |
| `approval-request` | 承認が必要。クライアントは POST `/api/agent/approval` で応答 |
| `run-status` | 実行のスナップショット（保留中の承認を含む）。再生の最後には必ず 1 件届く |
| `truncated` | 要求した開始点がリングバッファから追い出された。クライアントはメッセージを再構築する必要がある |
| `usage` | 実際のトークン使用量 |
| `run-finish` | 実行の完了 |
| `error` / `warning` / `aborted` | エラー / 警告（「N 件の履歴を省略」など）/ キャンセル |
| `data: [DONE]` | ストリームの終端 |
| `: ping` | 承認待ちの間、20 秒ごとのハートビートコメント |
| `/ws/terminal` | WebSocket | PTY ターミナル（node-pty が必要。非ループバックにはトークンが必要） |

---

## リポジトリ構成

```
pocketd/
├── server.ts                 # エッジ層：Hono ルート、トークンゲート、ターミナル WS、SPA
├── src/agent/                # エージェントコア
│   ├── runtime.ts            #   ワークスペースサンドボックス、パス解決、ゴミ箱、シークレット、走査
│   ├── tools.ts              #   組み込みツール群 + シェル実行
│   ├── permissions.ts        #   承認ポリシー、ハード拒否ルール、承認ブローカー
│   ├── loop.ts               #   多段エージェントループ（Vercel AI SDK）
│   ├── mcp.ts                #   MCP クライアント管理（公式 SDK、HTTP + stdio）
│   ├── sessions.ts           #   セッション永続化（node:sqlite）
│   ├── search.ts             #   検索と置換（Node 標準ライブラリ）
│   ├── ignore.ts             #   gitignore セマンティクスの無視ルール
│   ├── shell.ts              #   POSIX シェル優先の解決（ADR-003）
│   └── git.ts                #   Git の呼び出し
├── tests/
│   ├── agent.test.ts         # ツール層 / 権限 / ループの回帰テスト
│   ├── brand-assets.test.ts  # アイコンと manifest のピクセル単位の検証
│   ├── e2e-server.mts        # 実サーバー + stdio MCP のエンドツーエンド
│   └── fixtures/             # 偽の LLM 上流、MCP テストサーバー
├── tools/
│   ├── make-icons.mjs        # PNG ブランドアイコンの生成（依存ゼロ）
│   └── png-read.mjs          # 検証用にピクセルを読み戻すデコーダ
├── ui/                       # フロントエンド（Vite + React + TS）
│   ├── src/
│   │   ├── App.tsx / main.tsx / store.ts
│   │   ├── monaco-themes.ts  # CSS トークンに合わせた Monaco テーマ
│   │   ├── lib/              # API クライアント、ダイアログ API、ブランド、ビューポート hook
│   │   └── components/       # チャット、エディタ、ファイルツリー、ターミナル、Git、検索、統計
│   ├── public/               # アイコン（SVG + 生成 PNG）と manifest
│   └── dist/                 # ビルド成果物（gitignore 対象）
├── docs/
│   ├── ARCHITECTURE.md       # 技術的な深掘り（デザインシステムを含む）
│   ├── adr/                  # アーキテクチャ決定記録
│   └── MOBILE.md             # モバイルとアクセシビリティのメモ
├── termux-setup.sh           # Termux 用のワンクリック導入／起動
├── TERMUX-QUICKSTART.md
├── CONTRIBUTING.md
└── LICENSE
```

---

## アーキテクチャ

```
┌────────────────────────────────────────────────────────────────┐
│                    Android 端末 / macOS / Linux                 │
│                                                                │
│  ┌──────────────┐        ┌──────────────────────────────────┐  │
│  │ ブラウザ(PWA)│        │ Termux / ローカルホスト          │  │
│  │  Monaco      │        │  ┌────────────────────────────┐  │  │
│  │  xterm       │◀──────▶│  │ server.ts  エッジ層        │  │  │
│  │  ツール/承認 │  SSE   │  │  Hono · トークン · ws      │  │  │
│  └──────────────┘   +WS  │  └────────────┬───────────────┘  │  │
│                          │               │                  │  │
│                          │  ┌────────────▼───────────────┐  │  │
│                          │  │ エージェントコア(src/agent)│  │  │
│                          │  │  loop ─ tools ─ permissions│  │  │
│                          │  │  mcp · sessions · search   │  │  │
│                          │  └────────────┬───────────────┘  │  │
│                          │               │                  │  │
│                          │  ファイルシステム / shell / git  │  │
│                          │              + node-pty          │  │
│                          └──────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

SPA は `ui/dist/` から配信されます。チャットは SSE（テキスト差分、ツール呼び出し、承認要求、使用量）、ターミナルは WebSocket を経由します。エージェントループはサーバー側で動き、そのツールはワークスペースに直接作用します。データはすべて `~/.pocketd/` にローカルに留まります。

> 技術的な詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、主要なトレードオフは [docs/adr/](docs/adr/) にあります。

---

## 開発

```bash
# サーバー — 起動（ui/dist が存在している必要があります）
npm install
cd ui && npm install && npm run build && cd ..
npm start

# フロントエンド — HMR での単独開発
cd ui && npm install && npm run dev

# 型チェック（サーバー + フロントエンド）
npm run typecheck

# テスト：サーバーのツール層とエージェントループ
npm test

# テスト：フロントエンドのコンポーネント（Vitest + Testing Library）
npm run test:ui

# テスト：エンドツーエンド（実サーバー + 実 stdio MCP + 承認の往復）
npm run test:e2e

# 本番ビルド
npm run build

# ブランドアイコンの再生成（Brand.tsx のマーク形状を変えたときに必要）
npm run icons
```

サーバーは `ui/dist/index.html` の有無で動作を決めます。あれば SPA を配信し、なければ 503 を返してフロントエンドのビルドを促します。

実際の API キーがなくても動かせます。`npm run test:e2e` には偽の OpenAI 互換上流が含まれています。手動でスモークテストする場合は `node tests/fixtures/fake-upstream.mjs 3198` を起動し、`POCKETD_API_BASE=http://127.0.0.1:3198/v1` をそこに向けます。

### デザインシステム

色、文字サイズ、角丸、レイヤーはすべて `ui/src/index.css` のトークンにあり、コンポーネントは色やサイズの値を直書きしません。前景／背景のコントラストは WCAG 2.1 に照らして実測され、その値はトークンの隣に置かれています。両テーマとも完全です（Monaco、xterm、シンタックスハイライト、ネイティブコントロールのカラースキームを含む）。切り替えるとブラウザ UI の `theme-color` も更新されます。

見た目を変える前に [docs/ARCHITECTURE.md のデザインシステムの節](docs/ARCHITECTURE.md#design-system) を読んでください。ブランドマークを変える場合は `ui/src/components/Brand.tsx` と `ui/public/pocketd-icon.svg` の両方を更新し（`npm test` が両者のジオメトリ一致を検証します）、その後 `npm run icons` で PNG を再生成します。

---

## セキュリティ

| 項目 | 状態 |
|------|------|
| **待ち受けと認証** | 既定ではループバックのみ。`POCKETD_HOST=0.0.0.0` を設定すると、非ループバックの要求にアクセストークン（256 ビットの乱数、`0600` のファイルに保存）が必須になります。ターミナルの WebSocket も同じく検証されます |
| **エージェントのコマンド実行** | 承認ポリシー下の `bash` ツールのみを通ります。ハード拒否リスト（`rm -rf /`、`mkfs`、ブロックデバイスへの書き込み、フォーク爆弾など）は承認できません |
| **ファイル削除** | `trash/` に sidecar メタデータ付きで移動し、**元のパスに復元可能**。ワークスペースのルートを対象にするのは拒否します |
| **パスサンドボックス** | 範囲外の解決を拒否し、さらに最も深い既存の祖先に対して `realpath` を取るため、シンボリックリンクで読み書きをワークスペースの外に導けません |
| **Markdown XSS** | `react-markdown` + `rehype-sanitize`（カスタムスキーマ）。チャットとナレッジベースで共有 |
| **リクエストボディの上限** | `/api/chat/stream` 10MB、`/api/file` 5MB |
| **ツール出力** | 一律で切り詰め（30k 文字）。1 つのコマンドでコンテキストウィンドウが溢れることを防ぎます |

既知の未対応項目 — 公開露出（推奨しません）を検討する前に埋めてください：

- レート制限もログイン失敗のロックアウトもありません（トークン自体は総当たりできない長さですが、多層防御が欠けています）
- `bash` ツールはサンドボックスではありません — シェルそのものです。承認ポリシーが唯一のゲートであり、`auto` では実質的に開放です
- MCP stdio サーバーはあなたのユーザーとして起動します。その安全性は pocketd の制御範囲外です

---

## トラブルシューティング

| 症状 | 対処 |
|---------|-----|
| 白い画面 | フロントエンドが未ビルド：`cd ui && npm run build` |
| ターミナルが動かない | `node-pty` がありません：`pkg install clang make`（Termux） |
| チャットが 502 / エラー | 設定の API Base / Key / Model を確認 |
| 503 ステータス | `ui/dist/` がありません — 先にフロントエンドをビルドしてください |
| 401 未認証 | 別の端末からアクセスする場合はトークンを渡します：`?token=<token>`。トークンは端末の設定画面に表示されます |
| ポートの競合 | `POCKETD_PORT=4000 npx tsx server.ts` |
| ツールが常に拒否される | `strict` モードです。設定で `edits` に切り替えるか、承認時に「この選択を記憶」にチェックを入れてください |

---

## 依存関係

**サーバー**（`package.json`）：
- `hono` / `@hono/node-server` — HTTP フレームワークと Node アダプター
- `ws` — WebSocket サーバー
- `ai` / `@ai-sdk/openai-compatible` — LLM のオーケストレーションとプロバイダーアダプター
- `@modelcontextprotocol/sdk` — MCP クライアント（HTTP + stdio）
- `zod` — ツール引数のスキーマ
- `simple-git` — Git の呼び出し
- `ignore` — gitignore セマンティクスの無視ルール（検索と `@` 候補で使用）
- `node-pty` *（任意）* — ターミナルの PTY エミュレーション。`clang + make` が必要
- セッション保存は Node 24 組み込みの `node:sqlite`、検索は Node 標準ライブラリを使っており、いずれも依存を増やしません

**フロントエンド**（`ui/package.json`）：
- `react` / `react-dom` 19 — UI フレームワーク
- `zustand` 5 — 状態管理
- `@monaco-editor/react` + `monaco-editor` — コードエディタ
- `@xterm/xterm` 6 + `@xterm/addon-fit` + `@xterm/addon-web-links` — ターミナル
- `react-markdown` + `remark-gfm` + `rehype-sanitize` + `rehype-highlight` — Markdown とシンタックスハイライト
- `vite` 8 + `@vitejs/plugin-react` — ビルドツール
- `vitest` 5 + `@testing-library/*` + `jsdom` 30 — テスト

ビルドと型チェックには **TypeScript 7**（ネイティブ実装、`tsc` は 5.x と互換）を使っています。

`ui/package.json` に `overrides` が 1 件あります：`dompurify: ^3.4.17`。`monaco-editor` は dompurify を 3.4.15 に固定しており、そのバージョンには公表された XSS の勧告があります。monaco が自力で更新したらこの項目は削除できます。

z.ai / BigModel / OAuth / テレメトリの依存は一切ありません。

### フロントエンドのバンドルサイズ

highlight.js の言語定義は 87 個の**遅延読み込み**チャンクに分割されており（合計約 468 KB 非圧縮）、その言語のコードブロックが現れたときにだけダウンロードされます。メインチャンクは約 5.06 MB（gzip で 1.33 MB）で、大半は Monaco エディタとその worker です（`ts.worker` だけで 6.9 MB）。ビルド成果物の合計は約 15 MB で、PWA を一度インストールすれば Service Worker がキャッシュします。

---

## 関連プロジェクト

- [Termux](https://termux.dev) — Android のターミナルエミュレーター
- [Hono](https://hono.dev) — Web フレームワーク
- [Vercel AI SDK](https://ai-sdk.dev) — LLM のオーケストレーションとツールループ

---

## ライセンス

[MIT](LICENSE) © pocketd Contributors

本プロジェクトは独立したオープンソース実装であり、いかなるサードパーティ製デスクトップエージェントのクローズドソースコードも含みません。すべての依存関係は MIT / Apache-2.0 などのオープンソースコンポーネントです。

### 名称変更について

このプロジェクトは当初 **ZCode** という名前で、同名のデスクトップエージェントの考え方を Android 向けに実装したものでした。その名称は公式製品と重なるため、最初の公開リリースの前に **pocketd** へ改名しました。

改名は**無損失**です。旧環境変数の接頭辞（`ZCODE_*`）、旧データディレクトリ（`~/.zcode/`）、旧 localStorage キー、旧トークン cookie、旧ゴミ箱ディレクトリ、旧 `.zcodeignore` はすべて起動時に読み込まれるため、既存ユーザーが失うものはありません。シームレスにできないものがただ一つだけあります。PWA の `manifest.id` は `/` のままでなければならず、そうでなければインストール済みの PWA が別のアプリと見なされ再インストールが必要になります。これが唯一の実際のコストで、しかも一度きりです。
