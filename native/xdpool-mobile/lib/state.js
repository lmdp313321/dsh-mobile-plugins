// 读 dsh-xdpool 的本地状态文件。只读 + 脱敏：绝不读 token/key 明文内容，
// 只统计"有几个账号 / 几条渠道开了 / 有没有 key"，用于手机上看池健康。
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

/** 聚合渠道：只数 enabled 和有无 key，不碰 key 值。 */
function aggregateInfo() {
  const d = readJson(AGGREGATE)
  const providers = (d && d.providers) || {}
  const names = Object.keys(providers)
  let enabled = 0
  let withKey = 0
  const rows = []
  for (const name of names) {
    const v = providers[name] || {}
    const on = v.enabled === true
    const key = Boolean(v.apiKey && String(v.apiKey).length > 0)
    if (on) enabled += 1
    if (key) withKey += 1
    rows.push({ name, on, key })
  }
  // 面板只列前 12 条，按「已启用优先、有 key 其次」排
  rows.sort((a, b) => (Number(b.on) - Number(a.on)) || (Number(b.key) - Number(a.key)) || a.name.localeCompare(b.name))
  return { total: names.length, enabled, withKey, rows: rows.slice(0, 12) }
}

/** 账号池：只数账号个数与来源域名，不读 token。 */
function accountsInfo() {
  const d = readJson(ACCOUNTS)
  const list = (d && Array.isArray(d.accounts)) ? d.accounts : []
  const rows = list.slice(0, 12).map((a) => ({
    label: String(a.label || '?').split('#')[0],
    domain: String((a.credential && a.credential.domain) || ''),
  }))
  return { total: list.length, rows }
}

/** 读 settings.yaml 里的 xdpool.distribution / cooldownMs（极简解析，不用 yaml 库）。 */
export function readXdpoolSettings() {
  let text = ''
  try { text = fs.readFileSync(SETTINGS, 'utf8') } catch { /* 没有文件=全默认 */ }
  let distribution = 'priority'
  let cooldownMs = 60000
  let inBlock = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '')
    if (/^xdpool\s*:\s*$/.test(line)) { inBlock = true; continue }
    if (/^\S/.test(line) && !/^\s/.test(line)) inBlock = false
    if (!inBlock) continue
    let m = line.match(/^\s+distribution\s*:\s*(\S+)/)
    if (m) distribution = m[1].replace(/["']/g, '')
    m = line.match(/^\s+cooldownMs\s*:\s*(\d+)/)
    if (m) cooldownMs = Number(m[1])
  }
  return { distribution, cooldownMs }
}

/** 写 xdpool 设置到 settings.yaml：保留其它顶级块，只改/加 xdpool 块。 */
export function writeXdpoolSettings(patch) {
  let text = ''
  try { text = fs.readFileSync(SETTINGS, 'utf8') } catch { /* 新建 */ }
  const lines = text.split('\n')
  const out = []
  let i = 0
  let replaced = false
  while (i < lines.length) {
    const line = lines[i]
    if (/^xdpool\s*:/.test(line)) {
      replaced = true
      // 跳过整个 xdpool 块（顶格 key 之间都是它的子行）
      i += 1
      while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === '')) i += 1
      const s = readXdpoolSettingsFromLines(lines)
      const distribution = patch.distribution ?? s.distribution
      const cooldownMs = patch.cooldownMs ?? s.cooldownMs
      out.push('xdpool:')
      out.push(`  distribution: ${distribution}`)
      out.push(`  cooldownMs: ${cooldownMs}`)
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
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true })
  fs.writeFileSync(SETTINGS, out.join('\n').replace(/\n+$/, '\n'), 'utf8')
  return readXdpoolSettings()
}

function readXdpoolSettingsFromLines(lines) {
  let distribution = 'priority'
  let cooldownMs = 60000
  let inBlock = false
  for (const raw of lines) {
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

export function collect(locale) {
  const en = String(locale || '').startsWith('en')
  const acc = accountsInfo()
  const agg = aggregateInfo()
  const s = readXdpoolSettings()
  const distZh = { priority: '优先用完一个', sticky: '每对话固定一个', 'round-robin': '顺序轮换', balanced: '随机偏闲置' }
  const channelRows = agg.rows.map((r) => ({
    title: r.name,
    subtitle: `${en ? (r.on ? 'enabled' : 'off') : (r.on ? '已启用' : '未启用')} · ${r.key ? (en ? 'has key' : '有 key') : (en ? 'no key' : '无 key')}`,
    icon: r.on ? 'check' : 'more',
    tone: r.on ? 'good' : 'muted',
  }))
  return {
    m_accounts: String(acc.total),
    m_channels: String(agg.enabled),
    m_keys: String(agg.withKey),
    accounts_label: en ? 'Accounts' : '账号数',
    channels_label: en ? 'Channels on' : '启用渠道',
    keys_label: en ? 'With key' : '有 key',
    s_dist: en ? s.distribution : (distZh[s.distribution] || s.distribution),
    s_cooldown: `${Math.round(s.cooldownMs / 1000)}s`,
    channels_title: en ? 'Aggregated channels (top 12)' : '聚合渠道（前 12）',
    accounts_title: en ? 'WorkBuddy accounts' : 'WorkBuddy 账号',
    channelRows,
    accountRows: acc.rows.map((a) => ({ title: a.label, subtitle: a.domain, icon: 'user' })),
    hint: en
      ? 'Read-only status from local files. Settings write to ~/.dsh/settings.yaml and take effect immediately.'
      : '状态读自本地文件（不含密钥）。设置写入 ~/.dsh/settings.yaml，改完立即生效。',
  }
}
