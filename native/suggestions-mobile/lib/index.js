// dsh-mobile-suggestions —— 回复下方的「下一步建议」（手机原生版）。
//
// 移植说明：原项目 dsh-suggestion-chips（7★）靠一个 Cordis 工具让模型主动给建议，
// 那是 Harness Web UI 的能力，dsh-go 原生插件没有「注册工具给模型」的通道。
// 这里落地它自带的 Level 0 确定性提取器：从回复正文里抽出「可执行的下一步短语」，
// 长按回复一点就填进输入框（不自动发送，用户改完再发），避开高危操作一键直发的问题。
//
// 只在装了 dsh-go 桥接的主机上出现；写 ['dshGo']。
import { extractSuggestions } from './extract.js'

export const name = 'dsh-mobile-suggestions'

const isEn = (locale) => String(locale || '').startsWith('en')

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    // 长按回复 → 「建议内容」：抽下一步短语，填进输入框（不发送）
    ctx.dshGo.on('sg-copy', (scope, event) => {
      const en = isEn(event?.locale)
      const raw = String(scope?.message || '')
      const list = extractSuggestions(raw)
      if (list.length === 0) {
        return { toast: en ? 'No next-step found' : '这条没有可提取的下一步' }
      }
      // 多条时用编号列出，用户挑一条改；单条直接填进去
      const text = list.length === 1
        ? list[0]
        : list.map((s, i) => `${i + 1}. ${s}`).join('\n')
      return { insert: text.slice(0, 2000), toast: en ? 'Filled suggestions' : '建议已填入输入框' }
    })

    ctx.dshGo.on('sg-strip', (scope, event) => ({
      toast: isEn(event?.locale)
        ? 'Long-press a reply → Suggestions'
        : '长按 AI 回复 → 建议内容',
    }))
  })
}
