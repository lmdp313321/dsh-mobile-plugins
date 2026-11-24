// 把 Markdown / 代码块的回复抽成适合朗读的纯文本。
// 只做确定性清洗，不联网、不调用模型。
export function stripMarkdown(input) {
  let s = String(input || '')
  // 去掉代码块围栏行，保留里面的代码文字
  s = s.replace(/^\s*```[^\n]*$/gm, '')
  // 去掉标题井号
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  // 去掉列表符号
  s = s.replace(/^\s*[-*+]\s+/gm, '')
  s = s.replace(/^\s*\d+\.\s+/gm, '')
  // 去掉引用符号
  s = s.replace(/^\s*>\s?/gm, '')
  // 行内强调 / 代码 / 链接：保留文字
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/`([^`]+)`/g, '$1')
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  // 表格分隔行
  s = s.replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, '')
  // 合并多余空行
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}
