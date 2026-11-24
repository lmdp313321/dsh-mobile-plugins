// 读写 dsh-xdpool 的本地状态与设置文件。
// xdpool 每次请求都实时读 aggregate.json（readAggregateSettingsSync），所以改文件会生效。
// 只处理 enabled/apiKey 等字段；key 明文不显示、不进面板数据。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = process.env.DSH_HOME || path.join(process.env.HOME || os.homedir() || '/root', '.dsh')
const POOL_DIR = path.join(HOME, '.xdpool')
const ACCOUNTS = path.join(POOL_DIR, 'accounts.json')
const AGGREGATE = path.join(POOL_DIR, 'aggregate.json')
const SETTINGS = path.join(HOME, 'settings.yaml')

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}
function writeJson(file, data) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.dshmob.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}
function backup(file) {
  try { if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-xdmobile`) } catch {}
}

/** 渠道中文名（常见于 xdpool 聚合市场） */
const LABELS = {
  glm: '智谱 GLM', 'glm-cn': '智谱 GLM(国内)', kimi: 'Kimi 月之暗面',
  agnes: 'Agnes', baidu: '百度千帆', minimax: 'MiniMax', 'minimax-cn': 'MiniMax(国内)',
  opencode: 'OpenCode 免费模型', github_copilot: 'GitHub Copilot',
  groq: 'Groq', openrouter: 'OpenRouter', siliconflow: '硅基流动',
  nvidia: 'NVIDIA NIM', qiniu: '七牛云', deepseek: 'DeepSeek',
}

function channelLabel(id) { return LABELS[id] || id }

export function collect(locale) {
  const en = String(locale || '').startsWith('en')
  const accDoc = readJson(ACCOUNTS)
  const aggDoc = readJson(AGGREGATE)
  const accounts = (accDoc && Array.isArray(accDoc.accounts)) ? accDoc.accounts : []
  const providers = (aggDoc && aggDoc.providers) ? aggDoc.providers : {}
  const s = readXdpoolSettings()

  const channelRows = Object.keys(providers).map((id) => {
    const v = providers[id] || {}
    // xdpool：没有 enabled 字段视为启用
    const on = v.enabled !== false
    const hasKey = Boolean((v.apiKey && String(v.apiKey).length) || (Array.isArray(v.apiKeys) && v.apiKeys.length))
    const builtin = id === 'opencode' || id === 'github_copilot'
    const status = on ? (en ? 'ON' : '已启用') : (en ? 'OFF' : '未启用')
    const key = hasKey ? (en ? 'key' : '有key') : (builtin ? (en ? 'built-in' : '内置') : (en ? 'no key' : '无key'))
    return {
      title: `${channelLabel(id)} · ${status}`,
      subtitle: `${id} · ${key}`,
      icon: on ? 'check' : 'more',
      tone: on ? 'good' : 'muted',
      action: { id: 'toggle-channel', args: { id } },
    }
  })
  // 已启用优先、有 key 优先
  channelRows.sort((a, b) => {
    const ao = a.tone === 'good' ? 1 : 0, bo = b.tone === 'good' ? 1 : 0
    return bo - ao || a.title.localeCompare(b.title)
  })

  const distZh = { priority: '优先用完一个', sticky: '每对话固定', 'round-robin': '顺序轮换', balanced: '随机偏闲置' }
  let enabledCount = 0
  for (const v of Object.values(providers)) if (v && v.enabled !== false) enabledCount += 1

  return {
    m_accounts: String(accounts.length),
    m_channels: String(enabledCount),
    m_total: String(Object.keys(providers).length),
    accounts_label: en ? 'Accounts' : '账号数',
    channels_label: en ? 'Channels on' : '启用渠道',
    total_label: en ? 'Total channels' : '渠道总数',
    s_dist: en ? s.distribution : (distZh[s.distribution] || s.distribution),
    s_cooldown: `${Math.round(s.cooldownMs / 1000)}s`,
    channels_title: en ? 'Tap a channel to turn ON/OFF' : '点渠道切换开/关（改完即时生效）',
    hint: en
      ? 'Settings read/write local files. Channel toggle edits ~/.dsh/.xdpool/aggregate.json; xdpool re-reads it on next request. Key values are never shown.'
      : '设置读写本地文件。渠道开关改 ~/.dsh/.xdpool/aggregate.json，xdpool 下次请求即读取；key 明文不显示。备份为 .bak-xdmobile。',
    channelRows,
  }
}

/** 切换一个聚合渠道的 enabled */
export function toggleChannel(providerId) {
  const doc = readJson(AGGREGATE)
  if (!doc || !doc.providers || !(providerId in doc.providers)) {
    return { ok: false, msg: 'no such channel' }
  }
  backup(AGGREGATE)
  const v = doc.providers[providerId]
  // xdpool 里没有 enabled 字段 = 默认启用。所以"当前是否开"= enabled !== false。
  // 点一下就取反；显式写入 enabled，避免下次读取仍走默认。
  const isOn = v.enabled !== false
  const now = !isOn
  doc.providers[providerId] = { ...v, enabled: now }
  writeJson(AGGREGATE, doc)
  return { ok: true, enabled: now }
}

export function readXdpoolSettings() {
  let text = ''
  try { text = fs.readFileSync(SETTINGS, 'utf8') } catch {}
  let distribution = 'priority'
  let cooldownMs = 60000
  let inBlock = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '')
    if (/^xdpool\s*:\s*$/.test(line)) { inBlock = true; continue }
    if (/^\S/.test(line)) inBlock = false
    if (!inBlock) continue
    let m = line.match(/^\s+distribution\s*:\s*(\S+)/)
    if (m) distribution = m[1].replace(/["']/g, '')
    m = line.match(/^\s+cooldownMs\s*:\s*(\d+)/)
    if (m) cooldownMs = Number(m[1])
  }
  return { distribution, cooldownMs }
}

export function writeXdpoolSettings(patch) {
  let text = ''
  try { text = fs.readFileSync(SETTINGS, 'utf8') } catch {}
  const lines = text.split('\n')
  const out = []
  let i = 0, replaced = false
  const cur = readXdpoolSettings()
  while (i < lines.length) {
    const line = lines[i]
    if (/^xdpool\s*:/.test(line)) {
      replaced = true
      i += 1
      while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === '')) i += 1
      out.push('xdpool:')
      out.push(`  distribution: ${patch.distribution ?? cur.distribution}`)
      out.push(`  cooldownMs: ${patch.cooldownMs ?? cur.cooldownMs}`)
      continue
    }
    out.push(line)
    i += 1
  }
  if (!replaced) {
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
    if (out.length > 0) out.push('')
    out.push('xdpool:')
    out.push(`  distribution: ${patch.distribution ?? 'priority'}`)
    out.push(`  cooldownMs: ${patch.cooldownMs ?? 60000}`)
  }
  try { if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.bak-xdmobile`) } catch {}
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true })
  fs.writeFileSync(SETTINGS, out.join('\n').replace(/\n+$/, '\n'), 'utf8')
  return readXdpoolSettings()
}
