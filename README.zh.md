# dsh-backstory

[![CI](https://github.com/MeghanBao/dsh-backstory/actions/workflows/ci.yml/badge.svg)](https://github.com/MeghanBao/dsh-backstory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![dsh plugin](https://img.shields.io/badge/dsh-plugin-6f42c1.svg)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) · **中文**

> 给任意一行代码问一句它的**来龙去脉**——*它做什么*，以及*为什么在这儿*。

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件。
`git blame` 告诉你一行是*谁*、*什么时候*写的；`dsh-backstory` 补上真正重要的那部分——
面对陌生代码时你想知道的：**它做什么、为什么存在**——依据是最后改动它的那次提交，
*外加* agent 自己的历史：**哪一轮写了这行，以及触发它的那句 prompt。**

```
L1 · a5d49e9 … 🧬t14
    export const greeting_de = "Willkommen"
🧬 origin · turn 14 — you asked: "支持德语双语" [ledger-hash]
```

## 和别的有什么不一样

- `git blame` → *谁 / 何时 / 哪次提交*。
- **`dsh-backstory`** → *这行做什么* + *为什么在这儿*，一处给全。
- 不是泛泛的"解释这段代码"（任何 LLM 都能干）。这里的 **why** 来自真实的仓库历史
  和 agent 历史，所以答案是**有据可依**的，不是猜的。
- 当**是 agent 自己**写的这行时，它给出 `git blame` 永远给不了的 dsh 原生溯源——
  *哪一轮写的、你当时说了什么*——精确到每一行（`🧬t14`）也精确到文件。

## 溯源：三层

每一行按"哪个来源最精确"依次归属：

1. **Ledger 内容 hash**（`[ledger-hash]`）—— 每次 write/edit 都被记录到仓库内提交的
   `.dsh/backstory.jsonl`，带上被改动行的内容哈希。按**文本**匹配，所以一行在文件里
   上下移动（行号漂移）也照样命中。跨 session、跨机器、跨人持久保留。
2. **Commit trailer**（`[commit]`）—— 一旦带着 `DSH-Turn` / `DSH-Prompt` trailer 提交，
   `git blame → sha → trailer` 就能还原溯源，而且**漂移由 git 自己处理**。
3. **实时 session 日志**（`[session]`）—— 当前 session 里、东西还没落进 ledger 之前，
   从 `exec.agent.session.events` 重建。

三层都会优雅降级：没有 ledger、没有 trailer、甚至没有 git，你依然能拿回源码行。

## 安装

```sh
dsh plugin add dsh-backstory      # 发布到 npm 后
```

安装后，dsh 宿主会应用 `package.json` 里声明的 bundle patch
（`dsh.bundle.patch` → [`cordis.patch.yml`](cordis.patch.yml)），把插件插入运行中的
composition，无需额外接线。

本地开发可直接跑源码：

```sh
git clone https://github.com/MeghanBao/dsh-backstory.git
cd dsh-backstory
npm run typecheck   # tsc --noEmit
npm test            # blame 解析、provenance、ledger、hash 归属、git e2e
```

独立的 [`cordis.yml`](cordis.yml) 只加载本插件，方便本地迭代。

## 用法

直接输入 **`/backstory`** 命令，可带文件和行范围：

```
/backstory src/auth.ts:40-60
/backstory utils/date.ts
```

或用自然语言问 agent（用的是同一个 `backstory` 工具）：

- *"`src/auth.ts` 第 88 行的来龙去脉是什么？"*
- *"解释 `utils/date.ts` 10–40 行，以及每部分为什么在那儿"*

工具会返回每一行 + 最后改动它的提交（作者、日期、信息），以及——若已知——写下它的
agent 轮次/prompt（`🧬t<turn>`）。agent 用代码本身讲*做什么*，用提交信息 + 溯源讲
*为什么*。不在 git 仓库里时优雅降级为只给源码。

### 工具：`backstory`

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | string（必填） | 绝对路径或相对工作区路径 |
| `line` | number | 起始行（1 起）；省略则读整个文件 |
| `endLine` | number | 结束行；默认等于 `line` |

整文件读取上限 400 行。

### Ledger 与 commit trailer

插件通过 `tools/post-execute` 观察器**自动**把每次 `write`/`edit` 记录到
`.dsh/backstory.jsonl`——把这个文件**提交**，溯源就随仓库走。

若想再把溯源锚进 git 历史（漂移交给 git 处理），每个 clone 装一次
`prepare-commit-msg` 钩子：

```sh
npm run install-hook
```

之后每次提交都会把暂存文件对应的最新 ledger 记录自动折进 trailer：

```
DSH-Turn: 14
DSH-Prompt: 支持德语双语
DSH-Session: 0f3a…
```

钩子是尽力而为（绝不阻断提交）、幂等（`--amend` 也安全）、删掉即停用；若已有同名钩子
会备份为 `*.backup`。

### 增量解释

解释一行要花一次模型调用，所以解释会被缓存。agent 解释完 `backstory` 结果里
`unexplained` 的那些行后，调用 `backstory_remember` 把它们存下来——按每行的**内容 hash**
存进 `.dsh/backstory-notes.jsonl`。下次未改动的行会直接带着 `explanation`（`↳`）返回，
只有文本变了的行才需要重新解释。省钱，且永不过时。

### 隐私：脱敏与 opt-out

prompt 会存进 ledger（并经钩子进 commit trailer），所以在写入前会**自动脱敏**常见密钥——
OpenAI / GitHub / AWS / Slack / Google 密钥、JWT、`Bearer` token，以及
`password` / `token` / `secret` / `api_key` 这类 `键=值` 会被替换成 `[REDACTED]`。

用 `.dsh/backstory.config.json` 可关闭记录或加自定义规则：

```json
{ "record": true, "redactPatterns": ["ACME-\\d+"] }
```

或用环境变量全局关闭：`DSH_BACKSTORY_DISABLE=1`。

> ⚠️ 脱敏是尽力而为的模式匹配，不是保证——push 前先看提交，敏感内容直接 opt-out。

## 路线图

- **v0.1** — git 历史 backstory：行 → 提交 → what/why。✅
- **v0.2** — dsh 原生半边：从实时 session 日志重建哪一轮写了文件 + 触发的 prompt（文件级）。✅
- **v0.3a** — **持久化行级 ledger**：每次 write/edit 记进 `.dsh/backstory.jsonl`
  （轮次、prompt、被改动行、内容 hash）；跨 session/机器/人保留。✅
- **v0.3b** — **抗漂移归属**：按内容 hash 匹配行，行移位也不丢溯源。✅
- **v0.4** — **git 原生溯源**：`DSH-*` commit trailer，经 `git blame → sha → trailer`
  还原，漂移交给 git；外加 `prepare-commit-msg` 钩子安装器（`npm run install-hook`），
  自动把 ledger 记录折进 trailer。✅
- **v0.5** — **隐私**：存储的 prompt 自动脱敏密钥 + `.dsh/backstory.config.json` /
  `DSH_BACKSTORY_DISABLE` 的 opt-out。✅
- **v0.6** — **`/backstory` 用户命令**（注册为 dsh skill），带 file:line 参数驱动工具。✅
- **v0.7** — **增量解释**：按内容 hash 缓存逐行解释（`backstory_remember` →
  `.dsh/backstory-notes.jsonl`），只重解释变动的行。✅

## 状态

针对 `dsh` 开发者预览版构建——API 可能变动。blame 解析、provenance 引擎、ledger、
hash 归属、git-blame 与 commit-trailer 路径共 **43 个测试**覆盖（纯逻辑 + 对真实临时仓库
的 e2e）。所有运行时接触点（`exec.agent.session.events`、`tools/post-execute` 记录器）
都做了防御处理并优雅降级，工具不会崩。

## 许可证

[MIT](LICENSE) © Meghan Bao
