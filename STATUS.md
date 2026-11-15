# 开发状态

最后更新：2026-11-16

## 已完成的插件

| 插件 | 版本 | Host | Client | 真机可见 |
|---|---|---|---|---|
| `tts` 语音朗读 | 1.0.0 | ✅ 端点在线 | ✅ 槽位 active=true | ⏳ 待刷新页面 |
| `snippets` 快捷提示词 | 1.0.0 | ✅ 端点在线（出厂 4 条） | ✅ 已安装 | ⏳ 待刷新页面 |

> **为什么 Client 要刷新页面**：Host 半边是 Node 进程里的模块，装完立即生效；
> Client 半边要进浏览器的 `__DSH_BOOT__` 启动图，只有页面**重新加载**才会重新拉。
> 切标签页不算，必须真刷新。

## 环境修复记录

### 安装流程曾被卡死（已修）

**症状**：`plugin_manager install_bundle` 每次都失败，报
`git ls-remote git+ssh://git@github.com/Minglink/dsh-infinite-gen-4.git`。

**两层根因**：

1. pnpm 把 `git+https://` 依赖解析成了 `git@github.com:` 形式，走 SSH——而本机没有 ssh
   → 加 `url.insteadOf` 把三种 ssh 形式都重写到 https
2. 重写后能走 https 了，但那个仓库很大，手机网络克隆到一半就
   `RPC failed; curl 92 HTTP/2 stream reset` 中断

**真正的解法**：那个依赖（`dsh-infinite-gen-5`）**插件已被禁用、也不在 bundles 里**，
纯粹是历史残留，却让每次安装都要联网解析一遍。把它从 `dependencies` 移除后，
`pnpm install --offline` 2 秒完成。

备份留在 profile 目录：`package.json.bak-before-ig5-removal`、`pnpm-lock.yaml.bak-before-ig5-removal`。

### 手工安装的备用路径

如果哪天 `install_bundle` 又卡在网络上，可以绕开它：

```bash
P=~/.dsh/profiles/web
ln -sfn /path/to/plugin $P/node_modules/@scope/name
# 再把 "name": "link:/path/to/plugin" 加进 package.json 的 dependencies
# 并把 name 加进 dsh.profile.bundles
cd $P && pnpm install --offline
```

## 开发中修掉的真缺陷（共 6 个）

全部是验证脚本实测抓出来的，不是猜的。

### tts（3 个）

1. `useChat()` 用法错——它是选择器钩子 `useChat(selector)`
2. 块字段名错——节点用 `kind`，会话日志用 `type`，只认一个会永远取到空
3. **Hook 次数 13 vs 14**——会让 React 崩掉整个槽位（不只是本插件）

### snippets（3 个）

4. 保存返回陈旧数据——`configEditor.edit` 会重启插件，旧闭包读的是改前配置
5. 出厂片段删不掉——判据用了 `length>0`，全删光后回落到出厂值
6. 删除请求被判非法——`normalizeSnippet` 要求 title+text 都非空，删除只带 title

第 3 和第 5 个都是「看着能用、实际有坑」的类型：前者不测就装上会崩掉整条操作行，
后者用户会发现「自带的片段删不掉」。

## 待做

| 插件 | 痛点 | 状态 |
|---|---|---|
| `clipboard` 剪贴板互通 | 手机复制的文字在 DSH 里用 | 🔍 已探测：桥只有 `copyText`（写），读取需实测 |
| `share` 分享即提问 | 任何 App 分享 → 直接问 AI | 📋 计划 |

### 剪贴板探测结论（部分）

已确认壳桥 `window.androidBridge` 约 60 个方法里，剪贴板**只有写入**：

- `copyText` ✅ 有（写）
- 读剪贴板方法 ❌ 没有

而 `dsh-host-web-compat` 的注释明确记着 WebView 拒 `navigator.clipboard.writeText`
（`NotAllowedError`）。读权限更严，大概率也被拒。

**尚未实测**的三条路径：`navigator.clipboard.readText()`、`document.execCommand('paste')`、
`paste` 事件。要确认得在真机页面上跑探测代码——但这需要先刷新页面，
所以推后到两个现有插件验证完再做。

## 明确不做

- ❌ **完成提醒**：实测壳侧通知功能已在运行（`dsh-notify.xml` 里 `notify.offset=228101`
  说明它一直在追踪引擎事件），重复造轮子无意义
- ❌ **屏幕常亮**：本机桥里**没有** `keepScreenOn` 方法（网上的文档提到过，但这个壳版本没有）
- ❌ **移植 dsh-TUI / DSH Desktop**：手机上没对应场景
- ❌ **重做 AI 浏览器 / 手机控制**：壳侧已有 19 + 14 个工具，很完整
