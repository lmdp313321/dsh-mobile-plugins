/**
 * dsh-mobile-snippets — Host 半边。
 *
 * 职责：保存片段清单（出厂默认 + 用户自定义），通过只读/只写两个端点交给前端。
 *
 * ## 为什么自定义片段走 configEditor
 *
 * 「用户加一条快捷提示词」是配置写入，不是数据写入。DSH 的规则很明确：
 * 插件**不得**自己去读写 profile 的 `cordis.patch.yml`——那个文件属于用户，
 * 里面还有其他插件的 insert 行、注释和 `!!js` 表达式，插件动它会毁掉用户的配置。
 *
 * 正确做法是 `ctx.get('configEditor').edit(entry, change)`：它保留文件其余部分、
 * 校验候选值、与其他 profile 变更串行化，并拒绝被更高层覆盖的值。
 * 所以自定义片段存进本插件自己那一行的 `config.snippets` 里。
 *
 * ## 端点
 *
 * - `GET  /api/dsh-mobile-snippets/config` 读全部片段
 * - `POST /api/dsh-mobile-snippets/save`   增改删一条自定义片段
 *
 * 两者都做回环栅栏：非回环 Host 与跨站请求一律拒绝（写入端点尤其重要）。
 */

export const name = '@dsh-mobile/snippets'

/** webServer 注册端点；configEditor 只在保存时才需要，所以走 ctx.get 可选取。 */
export const inject = ['webServer']

const CONFIG_PATH = '/api/dsh-mobile-snippets/config'
const SAVE_PATH = '/api/dsh-mobile-snippets/save'

const ENGINE_PORT_ENV = 'DSH_ENGINE_PORT'
const DEFAULT_ENGINE_PORT = 4145

/** 出厂默认片段。config 里没给时用这套，保证装完就能用。 */
const FACTORY_SNIPPETS = [
  { title: '继续', text: '继续' },
  { title: '解释一下', text: '请用简单的话解释一下上面这段内容' },
  { title: '精简', text: '请把上面的回复压缩到三句话以内' },
  { title: '换个说法', text: '请用另一种更通俗的说法重写上面的回复' },
]

/** 单条片段的长度上限。手机输入框塞太长的东西没有意义，也容易误触。 */
const TITLE_MAX = 40
const TEXT_MAX = 4000
/** 自定义片段数量上限。 */
const CUSTOM_MAX = 40

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
 * 回环栅栏。`connection` 服务判定优先；它抛出时一律 fail-closed。
 * 写入端点必须过这一关——否则同网段的设备能改用户的片段。
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
 * 读请求体并解析 JSON。上限 64 KiB——片段不该有这么大，
 * 超过就是异常请求，直接拒绝而不是先读进内存。
 * @param req - 请求对象。
 * @returns 解析后的对象，或 null。
 */
async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > 64 * 1024) return null
    chunks.push(chunk)
  }
  if (total === 0) return null
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * 归一一条片段：裁长度、去空白、拒绝空值。
 * @param raw - 原始片段。
 * @returns 归一后的 `{title, text}`，非法时 null。
 */
function normalizeSnippet(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX) : ''
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, TEXT_MAX) : ''
  if (title === '' || text === '') return null
  return { title, text }
}

/**
 * 只归一标题，用于删除操作。
 *
 * 删除请求只带 `title`、不带 `text`，用 `normalizeSnippet` 会被判成非法（它要求两者都非空），
 * 于是删除请求永远匹配不到目标——实测就是这样"点了删除但删不掉"。
 * @param raw - 原始请求。
 * @returns 归一后的标题，非法时空串。
 */
function normalizeTitleOnly(raw) {
  if (raw === null || typeof raw !== 'object') return ''
  return typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX) : ''
}

/**
 * 归一片段数组。跳过非法项而不是整体失败——一条坏数据不该让整栏消失。
 * @param raw - 原始数组。
 * @param limit - 数量上限。
 * @returns 归一后的数组。
 */
function normalizeSnippets(raw, limit) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    const normalized = normalizeSnippet(item)
    if (normalized === null) continue
    out.push(normalized)
    if (out.length >= limit) break
  }
  return out
}

/**
 * 注册两个端点，并向前端提供片段清单。
 * @param ctx - 插件上下文。
 * @param config - 该行的 config。
 */
export function apply(ctx, config) {
  const maxCustom = Number.isFinite(config?.maxCustom)
    ? Math.max(1, Math.min(CUSTOM_MAX, Math.round(config.maxCustom)))
    : CUSTOM_MAX

  // 出厂片段与用户片段分开：改配置时只替换用户那段，出厂值不会被误删。
  const factory = normalizeSnippets(config?.snippets, maxCustom)
  const configured = factory.length > 0 ? factory : FACTORY_SNIPPETS

  /**
   * 读当前片段清单。
   *
   * 自定义片段存在本插件这一行的 `config.snippets` 里，所以直接读
   * Loader entry 的 options——这是本插件自己的配置，不是别人的文件。
   *
   * ## 必须区分「键不存在」与「空数组」
   *
   * 这里踩过一个真实的坑：早先写成 `normalized.length > 0 ? normalized : configured`，
   * 于是用户把片段**全删光**之后，长度又变 0，出厂默认值立刻复活——
   * 「删不掉的自带片段」。正确的判断是**配置里有没有这个键**：
   * 键不存在 → 用出厂值；键存在哪怕是空数组 → 尊重空，就是用户想要的空。
   * @returns 当前片段数组。
   */
  const readSnippets = () => {
    try {
      const entry = ctx.fiber?.entry
      const raw = entry?.options?.config?.snippets
      // 键不存在（undefined）才是「没配置过」，此时用出厂值。
      if (raw === undefined || raw === null) return configured
      return normalizeSnippets(raw, maxCustom)
    } catch {
      return configured
    }
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
          sendJson(res, 405, { ok: false, code: 'dsh-mobile-snippets-method-not-allowed' })
          return
        }
        if (routeRejected(req, connection)) {
          res.statusCode = 403
          res.setHeader?.('cache-control', 'no-store')
          res.end('')
          return
        }
        sendJson(res, 200, { ok: true, snippets: readSnippets(), maxCustom })
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: SAVE_PATH,
      handler: async (req, res) => {
        if (req.method !== undefined && req.method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'dsh-mobile-snippets-method-not-allowed' })
          return
        }
        // 写入端点：先过栅栏再读 body，避免未授权方触发解析。
        if (routeRejected(req, connection)) {
          res.statusCode = 403
          res.setHeader?.('cache-control', 'no-store')
          res.end('')
          return
        }

        const body = await readJsonBody(req)
        if (body === null) {
          sendJson(res, 400, { ok: false, code: 'dsh-mobile-snippets-bad-body' })
          return
        }

        const editor = (() => {
          try {
            return ctx.get('configEditor')
          } catch {
            return undefined
          }
        })()
        const entry = ctx.fiber?.entry
        if (editor === undefined || entry === undefined) {
          // 如实说明为什么存不了，而不是假装保存成功。
          sendJson(res, 503, {
            ok: false,
            code: 'dsh-mobile-snippets-no-editor',
            message: '这个 profile 里没有配置编辑器，自定义片段无法持久化',
          })
          return
        }

        const action = typeof body.action === 'string' ? body.action : ''
        const candidate = normalizeSnippet(body.snippet ?? body)
        // 删除只关心标题：请求里不带 text 是正常的。
        const removeTitle = normalizeTitleOnly(body.snippet ?? body)

        // 在 change 回调里就地算出「改完之后的样子」，用闭包变量带出来。
        //
        // 为什么不能事后调用 readSnippets()：`configEditor.edit` 会 `fiber.resolveConfig(next)`
        // 重启本插件，apply 重新执行、闭包被换掉；本次请求手里这个闭包读到的仍是**改前**的
        // entry.options.config。实测就是「保存成功但返回的还是旧清单」，前端于是看不到自己刚存的东西。
        // 所以结果必须由这次 change 自己算出来。
        let committed = null
        try {
          await editor.edit(entry, (current) => {
            const raw = current?.snippets
            // 键不存在才是「没配置过」，用出厂值；空数组是用户真的要空。同 readSnippets 的判据。
            const base = raw === undefined || raw === null ? configured : normalizeSnippets(raw, maxCustom)

            if (action === 'remove') {
              committed = removeTitle === '' ? base : base.filter((item) => item.title !== removeTitle)
              return { ...current, snippets: committed }
            }

            if (candidate === null) {
              committed = base
              return { ...current, snippets: base }
            }
            // 同名覆盖：手机上不想区分"新增"和"编辑"，点保存就是我要这条是这样。
            const without = base.filter((item) => item.title !== candidate.title)
            committed = [candidate, ...without].slice(0, maxCustom)
            return { ...current, snippets: committed }
          })
        } catch (error) {
          sendJson(res, 409, {
            ok: false,
            code: 'dsh-mobile-snippets-rejected',
            message: error instanceof Error ? error.message : String(error),
          })
          return
        }

        sendJson(res, 200, { ok: true, snippets: committed ?? [], maxCustom })
      },
    }),
  )
}
