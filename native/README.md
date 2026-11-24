# dsh-go 原生插件（当前手机 App 可用）

这一目录是**给 dsh-go 手机原生界面**的插件——就是你现在这个 App 真正能显示的版本。

> 根目录下的 `tts/` 和 `snippets/` 是旧版 **Cordis bundle**（给 Harness 网页壳用），
> 在 dsh-go 原生界面里看不到。本目录是它们的原生重做版，外加一个高星插件移植。

## 插件清单

| 插件 | 来源 | 原项目星数 | 解决什么 | 界面入口 |
|---|---|---|---|---|
| `snippets-mobile` | 本地自研 | — | 手机打字慢，常用语一点就填入 | 输入框上方「快捷语」胶囊 → 面板 |
| `tts-mobile` | 本地自研 | — | 走路躺着时听 AI 回复 | 长按回复 →「朗读」 |
| `suggestions-mobile` | [dsh-suggestion-chips](https://github.com/taxueseek/dsh-suggestion-chips) | 7★ | 读完回复不知道下一步做啥，点建议就填入 | 长按回复 →「建议内容」 |

> 星数来自 GitHub API，采集于 2026-11-24，会变动。

### 关于高星插件的选择说明

市场里 star 最高的是 [@anysearch/anysearch-dsh](https://github.com/anysearch-team/anysearch-dsh)（708★），
但它是给 Agent 提供 `web_search` 工具的 **Cordis 工具型插件**，在引擎里工作、没有手机界面，
且本仓库主人的环境里已装免费的 `@liustack/modsearch`。把它"转成手机版原生插件"没有对应界面意义，
所以没有收录。真正适合转成 dsh-go 原生、且有明确手机交互价值的是建议胶囊这一类。

`reasonix-token-hud-dshgo` 项目本身已自带 dsh-go 原生版（`dshgo/` 目录），已在官方市场适配，不重复造轮子。

## 安装

在本机引擎里安装（profile 用 `web`）：

```bash
dsh plugin --profile web add /路径/dsh-mobile-plugins/native/snippets-mobile
dsh plugin --profile web add /路径/dsh-mobile-plugins/native/tts-mobile
dsh plugin --profile web add /路径/dsh-mobile-plugins/native/suggestions-mobile
```

改过 `lib/` 里的代码后，要在 App「引擎」页重启引擎才生效；`package.json` 清单改动会自动重读。

## 验证

每个插件都用 dsh-go-plugin 技能自带的检查器验证过（原生可见 + 宿主加载 + 视图可画）：

```bash
node ~/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs <插件目录> --load --lang zh
```

## 约束

- 只用 dsh-go 原生桥（`ctx.dshGo`），只在有桥接的主机出现，PC 上优雅隐藏
- 不联网、不硬编码密钥；`insert` 永远只填入输入框，绝不自动发送
- 数据只存在本机 `~/.dsh/dsh-go/`，不上传
