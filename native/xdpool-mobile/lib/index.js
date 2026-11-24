// dsh-mobile-xdpool —— 把 dsh-xdpool 的状态与关键设置搬到 dsh-go 原生界面。
//
// 背景：xdpool 的设置页注册在 Harness 网页版设置面板里，dsh-go 原生界面打不开
// （截图显示「暂不支持在这里设置」）。这个插件读它落在本机的 JSON 状态做只读看板，
// 并把两个关键设置（distribution / cooldownMs）写进 settings.yaml——和网页端同源。
//
// 安全：只读统计、不读 token/key 明文；写入前备份 settings.yaml；不联网。
import fs from 'node:fs'
import { collect, writeXdpoolSettings } from './state.js'

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
          title: en ? 'XD Pool status' : 'XD Pool 状态',
          children: [
            {
              type: 'row',
              children: [
                { type: 'metric', label: { $: 'data.accounts_label' }, value: { $: 'data.m_accounts' }, tone: 'good' },
                { type: 'metric', label: { $: 'data.channels_label' }, value: { $: 'data.m_channels' }, tone: 'info' },
                { type: 'metric', label: { $: 'data.keys_label' }, value: { $: 'data.m_keys' } },
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
                { label: en ? 'Set sticky' : '每对话固定号', action: 'set-sticky', icon: 'user' },
                { label: en ? 'Set round-robin' : '顺序轮换', action: 'set-rr', icon: 'refresh' },
                { label: en ? 'Set priority' : '优先用完一个', action: 'set-priority', icon: 'list' },
                { label: en ? 'Refresh' : '刷新', action: 'refresh', icon: 'refresh' },
              ],
            },
            { type: 'text', text: { $: 'data.channels_title' }, tone: 'muted' },
            { type: 'list', items: { $: 'data.channelRows' } },
            { type: 'text', text: { $: 'data.accounts_title' }, tone: 'muted' },
            { type: 'list', items: { $: 'data.accountRows' } },
            { type: 'callout', text: { $: 'data.hint' }, tone: 'info' },
          ],
        }
      },

      data: (scope, emit, caps) => {
        let dead = false
        const push = () => { try { emit(collect(caps?.locale)) } catch {} }
        push()
        return () => { dead = true }
      },

      actions: {
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
    // 写入前备份一次（首次写没有原文件也留个空备份，便于回滚定位）
    try { if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.bak-xdmobile`) } catch {}
    writeXdpoolSettings(patch)
    const label = patch.distribution
    return {
      refresh: true,
      toast: (en ? `Set to ${label}` : `已设为 ${label}`).slice(0, 40),
    }
  } catch (err) {
    return { toast: (en ? 'Write failed: ' : '写入失败：') + String(err?.message || err).slice(0, 24) }
  }
}
