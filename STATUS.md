# 开发状态

## dsh-mobile-tts v1.0.0

| 项 | 状态 | 说明 |
|---|---|---|
| 代码完成 | ✅ | Host + Client 双半边 |
| 语法检查 | ✅ | `node --check` 双文件通过 |
| 单元测试 | ✅ | 分段/边界/提取/硬切 5 项全通过 |
| 模块注册 | ✅ | 假环境验证：槽位 `conversation.chat.assistant-actions` order=20 |
| 桥契约验证 | ✅ | 假桥模拟 `ttsSpeak/ttsStop`，参数与返回解析正确 |
| Host 端点上线 | ✅ | `GET /api/dsh-mobile-tts/config` 返回 200 |
| 端点安全 | ✅ | 非回环 403 / 跨站 403 / POST 405 |
| 已推送 GitHub | ✅ | lmdp313321/dsh-mobile-plugins |
| Hook 稳定性 | ✅ | 三场景（有/无 useChat、无 messageId）全 13 个 Hook，不崩槽位 |
| 块格式兼容 | ✅ | 同时认节点 `kind` 与会话日志 `type` |
| **真机可见性** | ⏳ | **待重载页面**（Client bundle 需重新装载进 __DSH_BOOT__） |

## 修复记录（v1.0.0 开发中抓到的三个真缺陷）

这三个都是验证脚本实测抓出来的，不是猜的：

1. **`useChat` 用法错**：它签名是 `useChat(selector)` 的选择器钩子，
   不是返回整个快照。原来按 `useChat()` 写，永远取不到东西。
2. **块字段名错**：节点用 `kind` 标记类型，会话日志用 `type`。
   只认 `type` 会导致从节点取正文永远空串、按钮永久禁用。
3. **Hook 次数不稳定（最严重）**：实测「有 useChat 13 个 / 无 useChat 14 个」。
   次数不一致会让 React 报 `rendered fewer hooks than expected` 并**崩掉整个槽位**
   （不只本插件，整条 assistant 操作行都没了）。修复后三场景全 13 个。

## 待验证（重启后）

重启 DSH 后应能看到：

1. 任意一条 AI 回复下方出现「朗读」按钮
2. 点击后开始朗读，出现播放条「第 1/N 段」
3. 语速可调
4. 再点一次变「停止」

如未出现，检查：
- 浏览器控制台是否有 `slot entry crashed` 报错
- 页面是否真的重载过（不是切换标签页）
