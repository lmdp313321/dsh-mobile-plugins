/**
 * dsh-mobile-tts — Host 半边。
 *
 * 这个插件不做重活：朗读的执行面全在 **Client 半边**（壳桥 `window.androidBridge.ttsSpeak`
 * 只存在于 WebView 里，Host 进程够不到）。Host 侧只负责一件事：把「怎么读」的参数
 * 作为配置下发给前端，让用户能在 cordis.patch.yml 里调整而不必改代码。
 *
 * 为什么不注册工具：朗读是**看/听**的交互，不是模型该主动触发的动作。
 * 模型替用户决定"我要开始读了"是越权，也让每次回复多一次无意义的工具调用。
 *
 * 为什么不加 session 投影：朗读状态是纯前端瞬时状态（读到第几段），
 * 写进会话日志会让 fork/resume 带上一堆无意义的历史噪音。
 */

export const name = '@dsh-mobile/tts'

/** 只依赖可选的 webServer：它缺席时插件静默不激活，而不是让引擎启动失败。 */
export const inject = ['webServer']

/** 每次送入 TTS 引擎的最大字符数。 */
const DEFAULT_CHUNK_CHARS = 240
/** 语速倍率。 */
const DEFAULT_RATE = 1.1
/** 音高倍率。 */
const DEFAULT_PITCH = 1.0
/** 语速的合理边界：超出这个范围 TTS 引擎要么听不清要么变调失真。 */
const RATE_MIN = 0.5
const RATE_MAX = 2.5
/** 音高的合理边界。 */
const PITCH_MIN = 0.5
const PITCH_MAX = 2.0
/** 分段的字符数边界：太小会让每句都断，太大则引擎截断。 */
const CHUNK_MIN = 60
const CHUNK_MAX = 1200

const CONFIG_PATH = '/api/dsh-mobile-tts/config'

const ENGINE_PORT_ENV = 'DSH_ENGINE_PORT'
const DEFAULT_ENGINE_PORT = 4145

/**
 * 当前引擎端口。env 非法时返回 null（调用方一律拒绝）。
 * 不在模块顶层缓存：插件 import 早于 server.listen() 写 env。
 */
function enginePortFromEnv(env = process.env) {
  const raw = env[ENGINE_PORT_ENV]
  if (raw === undefined) return DEFAULT_ENGINE_PORT
  if (!/^[0-9]+$/.test(raw)) return null
  const port = Number(raw)
  return Number.isSafeInteger(port) && port >= 1024 && port <= 65535 ? port : null
}

/** 只信任实际监听端口的回环 authority；env 非法时返回空表。 */
function loopbackAuthorities(env = process.env) {
  const port = enginePortFromEnv(env)
  return port === null ? [] : ['127.0.0.1:' + port, 'localhost:' + port]
}

/**
 * 只读端点的回环栅栏。本端点只回配置参数（不含任何设备或用户数据），
 * 但仍拒绝非回环 Host 与跨站请求——一致的失败关闭姿态比"反正没数据"更可靠。
 */
function routeRejected(req, connection) {
  if (connection !== undefined) {
    try {
      return connection.requestRejection?.(req) === 403
    } catch {
      return true
    }
  }
  const headerOf = (header) => {
    const value = req.headers?.[header]
    return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined
  }
  const host = headerOf('host')?.trim().toLowerCase()
  const trusted = loopbackAuthorities()
  if (trusted.length === 0 || host === undefined || !trusted.includes(host)) return true
  if (headerOf('sec-fetch-site')?.toLowerCase() === 'cross-site') return true
  const origin = headerOf('origin')
  if (origin !== undefined && origin !== '' && !trusted.some((a) => origin.toLowerCase() === 'http://' + a)) {
    return true
  }
  return false
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader?.('content-type', 'application/json; charset=utf-8')
  res.setHeader?.('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * 把外部配置钳进安全范围。
 *
 * 为什么钳而不拒绝：这两个值调坏了只会让听感变差，不是安全问题；
 * 为了一个语速值让整个插件启动失败不值得。但也不能直接信任——
 * rate=100 会让 TTS 引擎输出无法辨识的噪音。
 * @param value - 配置值。
 * @param min - 下界。
 * @param max - 上界。
 * @param fallback - 非法时使用的默认值。
 * @returns 钳制后的数值。
 */
function clamp(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

/**
 * 注册配置端点。
 * @param ctx - 插件上下文。
 * @param config - 该行的 config。
 */
export function apply(ctx, config) {
  const resolved = {
    chunkChars: Math.round(clamp(config?.chunkChars, CHUNK_MIN, CHUNK_MAX, DEFAULT_CHUNK_CHARS)),
    rate: Math.round(clamp(config?.rate, RATE_MIN, RATE_MAX, DEFAULT_RATE) * 100) / 100,
    pitch: Math.round(clamp(config?.pitch, PITCH_MIN, PITCH_MAX, DEFAULT_PITCH) * 100) / 100,
  }

  const connection = (() => {
    try {
      return ctx.get('connection')
    } catch {
      return undefined
    }
  })()

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: CONFIG_PATH,
      handler: async (req, res) => {
        if (req.method !== undefined && req.method !== 'GET') {
          sendJson(res, 405, { ok: false, code: 'dsh-mobile-tts-method-not-allowed' })
          return
        }
        if (routeRejected(req, connection)) {
          res.statusCode = 403
          res.setHeader?.('cache-control', 'no-store')
          res.end('')
          return
        }
        sendJson(res, 200, { ok: true, ...resolved })
      },
    }),
  )
}
