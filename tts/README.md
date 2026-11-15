# dsh-mobile-tts — 语音朗读

把 AI 的回复**朗读出来**。走路、做饭、躺下时，用耳朵听。

## 为什么这是手机专属插件

手机上你经常腾不出眼睛。PC 上盯着屏幕看就够了，手机上不行。

**技术事实**：Android WebView **不实现** `speechSynthesis`——Chromium 任何版本都不接系统 TTS 引擎。
dsh-mobile 壳为此补了一层 polyfill（在 `dsh-host-web-compat` 里），底层调
`window.androidBridge.ttsSpeak(text, lang, rate, pitch)`。

**但那是给插件用的垫片，全仓没有任何 UI 调用点。** 普通用户在手机上根本摸不到朗读能力——
这个插件把那层垫片接出来，做成真实按钮。

## 功能

- 每条 AI 回复下方一个「朗读 / 停止」按钮
- 长文自动按句分段朗读，段与段之间自然衔接
- 播放条显示「第 N/M 段」与进度
- 语速可实时调节（0.5–2.5×）
- 只朗读正文，**跳过模型的思考过程（reasoning）和工具调用**
- 离开会话自动停止，不会在后台继续念

## 安装

```bash
dsh plugin --profile web add lmdp313321/dsh-mobile-plugins/tts
```

装完重载页面即可看到每条回复下方的朗读按钮。

## 配置

在 profile 的 `cordis.patch.yml` 里调整：

```yaml
- id: dsh-mobile-tts
  config:
    chunkChars: 240   # 每次送入 TTS 的字符上限（60–1200）
    rate: 1.1         # 语速（0.5–2.5）
    pitch: 1.0        # 音高（0.5–2.0）
```

## 已知限制（如实说明）

**安卓 TTS 不支持暂停/继续。** 这不是本插件没做，而是底层语义限制：
`ttsSpeak` 只有「开始」和「停止」，没有暂停。所以：

- 点「停止」是真停
- 想接着听，会从**当前段开头**重读，而不是从暂停的那个字继续
- UI 上明确写了这一点，不假装支持

**进度是估算的。** `ttsSpeak` 同步返回只代表「已开始朗读」，没有进度回调。
插件按字数估时长（中文约 4 字/秒 × 语速）来推进分段，所以播放条是近似值，不是精确进度。

## 技术细节

| 项 | 说明 |
|---|---|
| 插入点 | `conversation.chat.assistant-actions` 槽位，order=20（在「反馈」之后） |
| 桥方法 | `ttsSpeak` / `ttsStop` / `ttsVoices` |
| 特性检测 | 无 `ttsSpeak` 时按钮禁用并提示原因，不静默失效 |
| 样式 | 只用 `--dsw-alias-*` 主题 token，跟随深色/浅色 |
| 依赖 | 不 import 任何 Harness Client 包，控件自己写 |

## License

MIT
