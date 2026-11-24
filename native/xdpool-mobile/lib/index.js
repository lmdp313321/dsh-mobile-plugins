// dsh-mobile-xdpool —— 把 dsh-xdpool 的设置真正搬进 dsh-go 原生界面。
//
// 背景：xdpool 的设置页注册在 Harness 网页版设置面板，dsh-go 里显示「暂不支持在这里设置」。
// 这个插件直接读写 xdpool 的本地文件（它每次请求都实时重读，所以改动即时生效）：
//   · 聚合渠道开关 → ~/.dsh/.xdpool/aggregate.json 的 enabled
//   · 账号分配方式 / 冷却 → ~/.dsh/settings.yaml 的 xdpool 块
// 安全：不显示 key 明文、不联网；每次写入前备份 .bak-xdmobile。
import fs from 'node:fs'
import { collect, toggleChannel, writeXdpoolSettings } from './state.js'

export const name = 'dsh-mobile-xdpool'

const isEn = (locale) => String(locale || '').startsWith('en')
const HOME = process.env.DSH_HOME || process.env.HOME || '/root'
const SETTINGS = `${HOME}/settings.yaml`

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.panel('xd-panel', {
      view: (scope, caps) => {
        const en = isEn(caps?.locale)
        return {
          type: 'stack',
          title: en ? 'XD Pool settings' : 'XD Pool 设置',
          children: [
            {
              type: 'row',
              children: [
                { type: 'metric', label: { $: 'data.accounts_label' }, value: { $: 'data.m_accounts' }, tone: 'good' },
                { type: 'metric', label: { $: 'data.channels_label' }, value: { $: 'data.m_channels' }, tone: 'info' },
                { type: 'metric', label: { $: 'data.total_label' }, value: { $: 'data.m_total' } },
              ],
            },
            {
              type: 'keyValue',
              items: [
                [en ? 'Distribution' : '账号分配', { $: 'data.s_dist' }],
                [en ? 'Cooldown' : '冷却时长', { $: 'data.s_cooldown' }],
              ],
            },
            {
              type: 'actions',
              items: [
                { label: en ? 'Sticky' : '每对话固定号', action: 'set-sticky', icon: 'user' },
                { label: en ? 'Round-robin' : '顺序轮换', action: 'set-rr', icon: 'refresh' },
                { label: en ? 'Priority' : '优先用完一个', action: 'set-priority', icon: 'list' },
                { label: en ? 'Refresh' : '刷新', action: 'refresh', icon: 'refresh' },
              ],
            },
            { type: 'text', text: { $: 'data.channels_title' }, tone: 'muted' },
            { type: 'list', items: { $: 'data.channelRows' } },
            { type: 'callout', text: { $: 'data.hint' }, tone: 'info' },
          ],
        }
      },

      data: (scope, emit, caps) => {
        const push = () => { try { emit(collect(caps?.locale)) } catch {} }
        push()
        return () => {}
      },

      actions: {
        // list item 的 action:'toggle-channel' → event.value 带该项信息；用 title 里的 id 定位
        'toggle-channel': (scope, event) => {
          const v = event?.value
          let id = ''
          if (typeof v === 'string') id = v
          else if (v && typeof v === 'object') id = v.id || v.providerId || ''
          if (!id) return { toast: isEn(event?.locale) ? 'No channel' : '没识别到渠道' }
          try {
            const r = toggleChannel(id)
            if (!r.ok) return { toast: isEn(event?.locale) ? 'Unknown channel' : '没有这个渠道' }
            return {
              refresh: true,
              toast: `${id} → ${r.enabled ? (isEn(event?.locale) ? 'ON' : '已开启') : (isEn(event?.locale) ? 'OFF' : '已关闭')}`,
            }
          } catch (err) {
            return { toast: (isEn(event?.locale) ? 'Failed: ' : '失败：') + String(err?.message || err).slice(0, 24) }
          }
        },
        'set-sticky': (scope, event) => write(event, { distribution: 'sticky' }),
        'set-rr': (scope, event) => write(event, { distribution: 'round-robin' }),
        'set-priority': (scope, event) => write(event, { distribution: 'priority' }),
        refresh: (scope, event) => ({ refresh: true, toast: isEn(event?.locale) ? 'Refreshed' : '已刷新' }),
      },
    })
  })
}

function write(event, patch) {
  const en = isEn(event?.locale)
  try {
    writeXdpoolSettings(patch)
    return { refresh: true, toast: (en ? `Set ${patch.distribution}` : `已设为 ${patch.distribution}`).slice(0, 40) }
  } catch (err) {
    return { toast: (en ? 'Write failed: ' : '写入失败：') + String(err?.message || err).slice(0, 24) }
  }
}
