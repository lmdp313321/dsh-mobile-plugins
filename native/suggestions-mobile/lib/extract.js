// Level 0 确定性提取器：从回复正文里抽出「下一步可执行短语」。
// 无模型调用、无网络——复刻原插件"零额外 token"的核心思路。
const DANGER = /(删除|清空|覆盖|格式化|重置|退款|转账|付款|删除所有|rm\s+-rf|drop\s+table|卸载)/i

export function extractSuggestions(input) {
  const text = String(input || '')
  const out = []
  const seen = new Set()
  const add = (s) => {
    const v = String(s || '').replace(/^\s*[-*+]\s+/, '').replace(/\*\*/g, '').trim()
    if (!v || v.length > 60 || seen.has(v)) return
    if (DANGER.test(v)) return // 高危操作降级：不提供一键直发
    seen.add(v)
    out.push(v)
  }

  // 1) 「接下来/下一步/你可以」引导的祈使句
  const nextRe = /(?:接下来|下一步|然后|你可以|建议|可以试着|不妨)[，,:：]?\s*([^\n。！？!?]{4,50})/g
  for (const m of text.matchAll(nextRe)) add(m[1])

  // 2) 形如「要不要我帮你 X？」「需要我 X 吗？」
  const offerRe = /(?:要不要我|需要我|想让我|让我来)\s*([^\n。！？!?吗]{3,40})/g
  for (const m of text.matchAll(offerRe)) {
    const v = m[1]
    add(/^帮我/.test(v) ? v : `帮我${v}`)
  }

  // 3) 明确的列表项（如果正文以「你可以这样」「选项」结尾）
  if (/(?:选项|可选|你可以这样做|以下几种)/.test(text)) {
    for (const line of text.split('\n')) {
      if (/^\s*\d+[.、)]\s*/.test(line) || /^\s*[-*+]\s+/.test(line)) add(line)
    }
  }

  return out.slice(0, 5)
}
