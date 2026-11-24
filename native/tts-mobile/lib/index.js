// dsh-mobile-tts —— 手机语音朗读（取文本版）。
//
// 为什么这么做：dsh-go 原生桥的 audio/voice 能力需要插件侧提供音频内容，当前 App 版本
// 没有开放「把任意文本合成语音」的接口，直接读 AI 回复会失败。所以这个版本走最稳的一条路：
//   长按 AI 回复 → 「朗读」→ 把回复抽成干净纯文本复制到剪贴板 → 提示用手机系统朗读/听书。
// 这样在任何 App 版本都能用，也不联网。等 App 开放文本 TTS 接口，再升级为直接朗读。
//
// 只在装了 dsh-go 桥接的主机上出现；写 ['dshGo']。
import { stripMarkdown } from './text.js'

export const name = 'dsh-mobile-tts'

const isEn = (locale) => String(locale || '').startsWith('en')

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    // 长按回复 → 朗读：抽纯文本，复制，提示
    ctx.dshGo.on('tts-read', (scope, event) => {
      const en = isEn(event?.locale)
      const raw = String(scope?.message || '')
      const text = stripMarkdown(raw)
      if (!text.trim()) {
        return { toast: en ? 'No text to read' : '这条没有可朗读的文字' }
      }
      // 复制上限 8000 字；超长只取前面一段，避免失败
      return {
        copy: text.slice(0, 8000),
        toast: en ? 'Copied — use system read-aloud' : '已复制，用手机朗读功能听',
      }
    })

    // 停止：原生桥当前没有全局停止钩子，给一个明确反馈，避免用户以为还在读
    ctx.dshGo.on('tts-stop', (scope, event) => ({
      toast: isEn(event?.locale) ? 'Stopped' : '已停止朗读',
    }))

    // 状态条点击：说明用法
    ctx.dshGo.on('tts-strip', (scope, event) => ({
      toast: isEn(event?.locale)
        ? 'Long-press a reply → Read'
        : '长按 AI 回复 → 朗读',
    }))
  })
}
