# dsh-mobile-snippets — 快捷提示词

把常说的话存成**片段**，输入框左侧一点就填。手机上不用再一个字一个字敲长句。

## 为什么这是手机专属插件

手机上打「请用简单的话解释一下上面这段内容」要半分钟，还容易按错。
把这些话存成片段，一点就有。PC 上有键盘，收益小得多。

生态里没有同类插件（本机 profile 里搜 `prompt|snippet|quick|shortcut` 全为空）。

## 功能

- 输入框左侧一个「片段」按钮
- 点一条：**整段替换**输入框内容（不追加、不自动发送）
- 内置 4 条出厂片段：继续 / 解释一下 / 精简 / 换个说法
- 右上角 `+` 可增删改，同名自动覆盖（不重复添加）
- 面板贴着按钮弹出，自动避开屏幕边缘

## 安装

```bash
dsh plugin --profile web add lmdp313321/dsh-mobile-plugins/snippets
```

装完重载页面，输入框左侧会出现「片段」按钮。

## 配置

```yaml
- id: dsh-mobile-snippets
  config:
    snippets:
      - title: 继续
        text: 继续
      - title: 解释一下
        text: 请用简单的话解释一下上面这段内容
    maxCustom: 40    # 自定义片段数量上限
```

面板里加的片段会写回这条配置（经 `configEditor`，保留文件其余部分）。

## 设计选择

**为什么整段替换而不是插入光标处？**
`inputActions` 有两个写入口：`setDraft(text)` 整段替换，`insertText(text, span)` 光标处插入
（后者要求 `span.draftRev` 与当前 rev 一致，是给并发插入用的）。手机上点「继续」，
用户想要的就是输入框里只有「继续」——追加在一段旧草稿后面反而要手动删。

**为什么不自动发送？**
填进去让用户确认再按发送，避免误触直接发出去。

**为什么片段存在插件配置里，而不是独立文件？**
DSH 有硬规则：插件不得自己读写 profile 的 `cordis.patch.yml`（那文件属于用户，
含其他插件的行和注释）。自定义片段走 `configEditor.edit()`——它保留文件其余部分、
校验候选值、与其他变更串行化。

## 开发中修掉的三个真缺陷

都是验证脚本实测抓出来的：

1. **保存返回陈旧数据**
   `configEditor.edit` 内部会 `fiber.resolveConfig()` **重启插件**，`apply` 重新执行。
   请求手里那个闭包读到的仍是改前的 `entry.options.config`，于是"保存成功但返回旧清单"。
   改为在 `change` 回调里就地算出结果带出来。

2. **出厂片段删不掉**
   原来判据是 `normalized.length > 0 ? normalized : configured`——全删光后长度又变 0，
   出厂值立刻复活。正确判据是**配置里有没有 `snippets` 这个键**：
   键不存在才是"没配置过"；键存在哪怕是空数组，就是用户想要的空。

3. **删除请求被判非法**
   `normalizeSnippet` 要求 `title` 和 `text` 都非空，而删除请求只带 `title`，
   于是永远匹配不到目标——"点了删除没反应"。改用只归一标题的 `normalizeTitleOnly`。

## 已知限制

- 自定义片段存在 profile 配置里，**换 profile 不共享**
- 没有导入导出（真需要的话走 `exportConfig` 桥）
- 面板不支持拖拽排序

## 技术细节

| 项 | 说明 |
|---|---|
| 插入点 | `conversation.input.left` 槽位，order=500 |
| 写入口 | `inputActions.setDraft` |
| 持久化 | `configEditor.edit()` → 本行 `config.snippets` |
| 端点 | `GET /config`、`POST /save`，均过回环栅栏 |
| 样式 | 只用 `--dsw-alias-*` token |
| 依赖 | 不 import Harness Client 包 |

## License

MIT
