// dsh-mobile-snippets —— 手机快捷短语。
//
// 为什么手机独有：手机上打长句很累。把常说的一句话存成按钮，输入框上方一点就填进输入框，
// 绝不自动发送——用户还能改。数据存在本机引擎目录的一个 JSON 文件里，不联网。
//
// 只在装了 dsh-go 桥接的主机上出现（手机本机引擎有）；写 ['dshGo']，不写 ['dshGo?']。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-mobile-snippets'

const HOME = process.env.DSH_HOME || path.join(process.env.HOME || os.homedir() || '/root', '.dsh')
const STORE = path.join(HOME, 'dsh-go', 'snippets.json')

// 出厂自带几条通用短语；用户删光也不会回落（用 null 标记「已初始化过」）。
const DEFAULTS = [
  { id: 'd1', title: '总结上面', text: '总结上面的对话，列三条要点。' },
  { id: 'd2', title: '说人话', text: '用简单的话再解释一遍。' },
  { id: 'd3', title: '翻译成英文', text: '把上面的内容翻译成英文。' },
  { id: 'd4', title: '接着写', text: '继续。' },
]

const isEn = (locale) => String(locale || '').startsWith('en')

function load() {
  try {
    const raw = fs.readFileSync(STORE, 'utf8')
    const data = JSON.parse(raw)
    if (Array.isArray(data?.items)) return data.items
  } catch { /* 文件不存在或损坏，初始化 */ }
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true })
    fs.writeFileSync(STORE, JSON.stringify({ items: DEFAULTS }, null, 2), 'utf8')
  } catch { /* 只读环境就用内存默认值 */ }
  return DEFAULTS.slice()
}

function save(items) {
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true })
    fs.writeFileSync(STORE, JSON.stringify({ items }, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

let cache = null
function items() {
  if (!cache) cache = load()
  return cache
}

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    // 胶囊：直接开面板
    ctx.dshGo.on('snippets-open', () => ({ open: 'panel:snippets-panel' }))

    ctx.dshGo.panel('snippets-panel', {
      view: (scope, caps) => {
        const en = isEn(caps?.locale)
        return {
          type: 'stack',
          title: en ? 'Quick phrases' : '快捷短语',
          children: [
            {
              type: 'text',
              text: en ? 'Tap a phrase to fill the input box (not sent).' : '点一条短语填进输入框（不会自动发送）。',
              tone: 'muted',
            },
            { type: 'list', items: { $: 'data.list' } },
            {
              type: 'actions',
              items: [
                { label: en ? 'Add' : '添加', action: 'add', icon: 'add', style: 'primary' },
                { label: en ? 'Refresh' : '刷新', action: 'refresh', icon: 'refresh' },
              ],
            },
            { type: 'text', text: { $: 'data.note' }, tone: 'muted' },
          ],
        }
      },

      data: (scope, emit, caps) => {
        const en = isEn(caps?.locale)
        const push = () => {
          const list = items().map((s) => ({
            title: String(s.title || '').slice(0, 24),
            subtitle: String(s.text || '').slice(0, 60),
            icon: 'bolt',
            action: 'use',
          }))
          emit({ list, note: en ? `Total ${items().length} phrases.` : `共 ${items().length} 条。` })
        }
        push()
        return () => {}
      },

      actions: {
        // 点列表里的一条 → 把 text 填进输入框
        use: (scope, event) => {
          const idx = Number(event?.value?.index ?? event?.value)
          const s = items()[idx]
          if (!s) return { toast: isEn(event?.locale) ? 'Not found' : '没找到这条' }
          return { insert: String(s.text || '').slice(0, 2000), toast: isEn(event?.locale) ? 'Filled' : '已填入' }
        },

        // 添加：从剪贴板取文字，标题取前 8 个字
        add: (scope, event) => {
          const text = (scope?.clipboard || '').trim()
          if (!text) {
            return { toast: isEn(event?.locale) ? 'Copy text first' : '先复制一段文字' }
          }
          const title = text.slice(0, 8)
          const next = items().concat([{ id: `u${Date.now()}`, title, text: text.slice(0, 2000) }])
          cache = next
          const ok = save(next)
          return {
            patch: { note: isEn(event?.locale) ? 'Added' : '已添加' },
            refresh: true,
            toast: ok ? (isEn(event?.locale) ? 'Added' : '已添加') : (isEn(event?.locale) ? 'Added in memory' : '已添加（本次会话）'),
          }
        },

        refresh: (scope, event) => {
          cache = load()
          return { refresh: true, toast: isEn(event?.locale) ? 'Refreshed' : '已刷新' }
        },
      },
    })
  })
}
