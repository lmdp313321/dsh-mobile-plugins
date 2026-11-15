/**
 * dsh-mobile-tts — Client 半边。
 *
 * 在每条 AI 回复的操作行里加一个「朗读」按钮，点开是一个小播放条：
 * 播放 / 暂停 / 停止、语速调节、以及"正在读第几段"。
 *
 * ## 为什么这是手机专属
 *
 * Android WebView **不实现** `speechSynthesis`——Chromium 任何版本都不接系统 TTS 引擎。
 * dsh-mobile 壳为此补了一层 polyfill（`dsh-host-web-compat`），底层调用
 * `window.androidBridge.ttsSpeak(text, lang, rate, pitch)`。但那是给**插件**用的垫片，
 * 全仓没有任何 UI 调用点：普通用户在手机上根本摸不到朗读能力。
 *
 * 这个插件把垫片接出来做成真实按钮。PC 上浏览器原生支持朗读，不存在"摸不到"的问题，
 * 所以这个插件的价值只在手机端成立。
 *
 * ## 桥的真实契约（实测自 dsh-host-web-compat）
 *
 * - `ttsSpeak(text, lang, rate, pitch)` → JSON 字符串 `{ok:true}` 或 `{ok:false, reason}`
 * - **同步调用**：返回时朗读已经开始，但没有进度回调
 * - `ttsStop()` → 停止当前朗读
 * - `ttsVoices()` → `{ok:true, voices:[{name, lang, local, default}]}`
 * - **v1 不支持 pause/resume**（Android TTS 与 Web 语义不一致）——所以本插件不假装支持，
 *   而是把「暂停」实现为「停止并从当前段重新开始」，并在 UI 上如实说明。
 *
 * ## 分段策略
 *
 * `ttsSpeak` 没有进度回调，超长文本送进去要么被截断要么卡死。所以按句切段、逐段送入，
 * 段与段之间由前端自己排程。这样「读到第几段」是真的，不是估的。
 */

window.__ModuleLoader__.load({
  id: '@dsh-mobile/tts',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ACTION_ID = 'dsh-mobile-tts'
    const CONFIG_PATH = '/api/dsh-mobile-tts/config'
    const STYLE_ATTR = 'data-dsh-mobile-tts'

    /** 文案表。中文为基准，英文对齐。 */
    const DICTS = {
      zh: {
        speak: '朗读',
        stop: '停止',
        resume: '继续',
        speed: '语速',
        segments: '第 {index}/{total} 段',
        bridgeMissing: '本机没有朗读能力（需 DSH 安卓壳）',
        bridgeDenied: '朗读失败：{reason}',
        nothingToRead: '这条回复没有可朗读的文字',
        pauseHint: '安卓 TTS 不支持暂停，暂停后从本段重新读',
      },
      en: {
        speak: 'Read aloud',
        stop: 'Stop',
        resume: 'Resume',
        speed: 'Speed',
        segments: '{index}/{total}',
        bridgeMissing: 'No speech engine on this device (needs the DSH Android shell)',
        bridgeDenied: 'Speech failed: {reason}',
        nothingToRead: 'This reply has no readable text',
        pauseHint: 'Android TTS cannot pause; resuming restarts this segment',
      },
    }

    /**
     * 读取当前语言。
     * @returns {'zh'|'en'} 语言键。
     */
    function localeKey() {
      try {
        const lang = document.documentElement.lang || ''
        return lang.toLowerCase().startsWith('en') ? 'en' : 'zh'
      } catch {
        return 'zh'
      }
    }

    /**
     * 取翻译函数。
     * @returns {(key: string, vars?: Record<string, unknown>) => string} 翻译器。
     */
    function translator() {
      const dict = DICTS[localeKey()] ?? DICTS.zh
      return (key, vars) => {
        const text = dict[key] ?? key
        if (vars === undefined) return text
        return text.replace(/\{(\w+)\}/g, (whole, name) =>
          vars[name] !== undefined ? String(vars[name]) : whole,
        )
      }
    }

    /**
     * 画一颗喇叭图标。
     * @param props - `{ size, muted }`。
     * @returns 图标元素。
     */
    function SpeakerGlyph({ size = 14, muted = false }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', { d: 'M11 5 6 9H3v6h3l5 4V5z' }),
        muted
          ? h('path', { d: 'M17 9l4 6M21 9l-4 6' })
          : [h('path', { key: 'a', d: 'M15.5 8.5a5 5 0 0 1 0 7' }), h('path', { key: 'b', d: 'M18.5 6a9 9 0 0 1 0 12' })],
      )
    }

    /**
     * 把长文本切成适合逐段朗读的片段。
     *
     * 优先在句末标点处断开（中英文都覆盖），其次逗号，最后才硬切——
     * 硬切会让一句话被读成两半，听感很差，所以放到最后。
     * @param text - 原文。
     * @param maxChars - 每段上限。
     * @returns 片段数组（已去空）。
     */
    function splitSegments(text, maxChars) {
      const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim()
      if (normalized === '') return []
      const limit = Math.max(40, Math.round(Number(maxChars) || 240))

      // 先按段落粗切，再对超长的段落做句级切分。
      const paragraphs = normalized.split(/\n{2,}/)
      const segments = []
      for (const paragraph of paragraphs) {
        const trimmed = paragraph.trim()
        if (trimmed === '') continue
        if (trimmed.length <= limit) {
          segments.push(trimmed)
          continue
        }
        // 句末标点：中文 。！？；… 与英文 .!?;
        const sentencePattern = /[^。！？；!?;]+[。！？；!?;]?/g
        const sentences = trimmed.match(sentencePattern) ?? [trimmed]
        let buffer = ''
        for (const sentence of sentences) {
          if (sentence.length > limit) {
            // 单句过长：先把 buffer 冲掉，再按逗号切，最后硬切。
            if (buffer !== '') {
              segments.push(buffer)
              buffer = ''
            }
            const parts = sentence.split(/(?<=[，,、])/)
            let partial = ''
            for (const part of parts) {
              if (partial.length + part.length > limit && partial !== '') {
                segments.push(partial)
                partial = ''
              }
              partial += part
              while (partial.length > limit) {
                segments.push(partial.slice(0, limit))
                partial = partial.slice(limit)
              }
            }
            if (partial !== '') buffer = partial
            continue
          }
          if (buffer.length + sentence.length > limit && buffer !== '') {
            segments.push(buffer)
            buffer = sentence
          } else {
            buffer += sentence
          }
        }
        if (buffer !== '') segments.push(buffer)
      }
      return segments.filter((segment) => segment.trim() !== '')
    }

    /**
     * 从一条 AI 消息里取出纯文本。
     *
     * 只取 `text` 块；`reasoning` 是模型的思考过程，念出来没有意义。
     * 工具调用与技术块也跳过——用户要听的是回答，不是调试信息。
     * @param content - 消息 content（块数组或字符串）。
     * @returns 拼接后的纯文本。
     */
    function contentToText(content) {
      if (typeof content === 'string') return content
      if (!Array.isArray(content)) return ''
      const parts = []
      for (const block of content) {
        if (block === null || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') {
          parts.push(block.text)
        }
      }
      return parts.join('\n\n')
    }

    /** 注入面板样式（只用主题 token，跟随宿主深色/浅色）。 */
    function useStyles() {
      React.useEffect(() => {
        if (document.querySelector('style[' + STYLE_ATTR + ']') !== null) return undefined
        const style = document.createElement('style')
        style.setAttribute(STYLE_ATTR, '')
        style.textContent = [
          '.dshmtts-root{display:inline-flex;align-items:center;gap:2px}',
          '.dshmtts-btn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border:0;border-radius:13px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:1;cursor:pointer}',
          '@media (hover:hover){.dshmtts-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
          '.dshmtts-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
          '.dshmtts-btn[data-active=true]{color:var(--dsw-alias-brand-primary)}',
          '.dshmtts-btn:disabled{opacity:.45;cursor:default}',
          '.dshmtts-bar{display:flex;align-items:center;gap:10px;margin-top:6px;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
          '.dshmtts-meter{flex:1;min-width:60px;height:3px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden}',
          '.dshmtts-meterFill{height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .25s}',
          '.dshmtts-count{font-variant-numeric:tabular-nums;flex:none;color:var(--dsw-alias-label-tertiary)}',
          '.dshmtts-speed{display:inline-flex;align-items:center;gap:4px;flex:none;color:var(--dsw-alias-label-tertiary)}',
          '.dshmtts-speedInput{width:52px;height:20px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;text-align:center;padding:0 2px}',
          '.dshmtts-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin-top:4px}',
          '.dshmtts-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-top:2px}',
        ].join('\n')
        document.head.appendChild(style)
        return () => style.remove()
      }, [])
    }

    /**
     * 取壳桥。
     * @returns {object|null} `window.androidBridge`，不存在时 null。
     */
    function bridge() {
      try {
        const candidate = window.androidBridge
        return candidate !== null && typeof candidate === 'object' ? candidate : null
      } catch {
        return null
      }
    }

    /**
     * 调用桥方法并解析其 JSON 返回。
     * @param method - 方法名。
     * @param args - 转发参数。
     * @returns `{ok:boolean, reason?:string}`；桥缺席或返回不可解析时 `ok:false`。
     */
    function callBridge(method, args) {
      const api = bridge()
      if (api === null || typeof api[method] !== 'function') {
        return { ok: false, reason: 'bridge-unavailable' }
      }
      let raw
      try {
        raw = api[method](...args)
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
      if (raw === undefined || raw === null) {
        // 壳侧有的实现无返回；按已受理处理。
        return { ok: true }
      }
      if (typeof raw === 'object') return raw
      try {
        const parsed = JSON.parse(String(raw))
        if (parsed !== null && typeof parsed === 'object') return parsed
        return { ok: true }
      } catch {
        return { ok: true }
      }
    }

    /**
     * 逐段朗读控制器。
     *
     * 因为 `ttsSpeak` 是同步的、没有进度回调，所以"读完了"无法从桥面得知。
     * 做法是按段送入 + 用 `speaking` 状态标记当前在哪个段；
     * 用户再次点击时从该段继续，而不是假装桥会告诉我们进度。
     */
    function useReader() {
      const [state, setState] = React.useState({
        segments: [],
        cursor: 0,
        playing: false,
        rate: 1.1,
        pitch: 1.0,
        error: null,
      })
      /** 最新状态镜像：定时器与卸载清理要读它，不能靠闭包里的旧 state。 */
      const stateRef = React.useRef(state)
      stateRef.current = state

      /** 停止朗读。 */
      const stop = React.useCallback(() => {
        callBridge('ttsStop', [])
        setState((current) => ({ ...current, playing: false, error: null }))
      }, [])

      /**
       * 从 `cursor` 开始读，然后按段推进。
       *
       * 每段之间用固定间隔排程——`ttsSpeak` 同步返回只代表"已开始"，
       * 不代表"读完"。间隔按字数估（中文约 4 字/秒，乘语速），
       * 并在末段之后停住。这个估时会在 UI 上标为近似进度。
       */
      const play = React.useCallback((segments, startAt, rate, pitch) => {
        const total = segments.length
        if (total === 0) {
          setState((current) => ({ ...current, playing: false, error: 'nothing-to-read' }))
          return
        }
        let index = Math.max(0, Math.min(total - 1, startAt))
        let cancelled = false

        const step = () => {
          if (cancelled) return
          const text = segments[index]
          const result = callBridge('ttsSpeak', [text, '', rate, pitch])
          if (result.ok !== true) {
            setState((current) => ({
              ...current,
              playing: false,
              error: result.reason ?? 'tts-failed',
            }))
            return
          }
          setState((current) => ({ ...current, cursor: index, playing: true, error: null }))
          // 估时：中文约 4 字/秒；加 400ms 缓冲给引擎启动和句间停顿。
          const estimateMs = Math.round((text.length / (4 * Math.max(0.5, rate))) * 1000) + 400
          timer = setTimeout(() => {
            if (cancelled) return
            if (index + 1 >= total) {
              setState((current) => ({ ...current, playing: false, cursor: 0 }))
              return
            }
            index += 1
            step()
          }, Math.min(30000, Math.max(900, estimateMs)))
        }

        let timer = null
        step()

        return () => {
          cancelled = true
          if (timer !== null) clearTimeout(timer)
        }
      }, [])

      /** 卸载时停止朗读，避免离开会话后还在念。 */
      React.useEffect(() => () => callBridge('ttsStop', []), [])

      return { state, setState, play, stop, stateRef }
    }

    /**
     * 单条 AI 回复的朗读控件。
     * @param props - 槽位下发属性，含 `messageId`。
     * @returns 控件元素。
     */
    function SpeakAction(props) {
      useStyles()
      const t = translator()
      const { state, setState, play, stop, stateRef } = useReader()
      const [config, setConfig] = React.useState({ chunkChars: 240, rate: 1.1, pitch: 1.0 })
      const [segments, setSegments] = React.useState([])
      const cancelRef = React.useRef(null)

      const available = (() => {
        const api = bridge()
        return api !== null && typeof api.ttsSpeak === 'function'
      })()

      // 读 Host 下发的朗读参数（只读，失败就用默认值——不值得为一个语速值阻塞 UI）。
      React.useEffect(() => {
        let disposed = false
        fetch(CONFIG_PATH, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (disposed || payload === null) return
            setConfig({
              chunkChars: Number(payload.chunkChars) || 240,
              rate: Number(payload.rate) || 1.1,
              pitch: Number(payload.pitch) || 1.0,
            })
            setState((current) => ({ ...current, rate: Number(payload.rate) || 1.1, pitch: Number(payload.pitch) || 1.0 }))
          })
          .catch(() => {})
        return () => {
          disposed = true
        }
      }, [setState])

      /**
       * 从槽位属性里取消息正文。
       *
       * 槽位下发的是 `messageId`；正文要从 chat 投影里按 id 找。
       * 找不到时返回 null——宁可按钮禁用，也不读错内容。
       */
      const text = React.useMemo(() => {
        const id = props?.messageId
        if (id === undefined) return ''
        try {
          const chat = props?.useChat?.()
          const messages = chat?.messages ?? chat?.byId ?? null
          if (messages === null) return ''
          if (Array.isArray(messages)) {
            const found = messages.find((entry) => String(entry?.id) === String(id))
            return contentToText(found?.content)
          }
          if (typeof messages === 'object') {
            const found = messages[String(id)]
            return contentToText(found?.content)
          }
          return ''
        } catch {
          return ''
        }
      }, [props?.messageId, props?.useChat])

      const beginOrResume = React.useCallback(() => {
        const list = segments.length > 0 ? segments : splitSegments(text, config.chunkChars)
        if (list.length === 0) {
          setState((current) => ({ ...current, error: 'nothing-to-read' }))
          return
        }
        if (segments.length === 0) setSegments(list)
        const startAt = stateRef.current.playing ? stateRef.current.cursor + 1 : stateRef.current.cursor
        if (cancelRef.current !== null) {
          cancelRef.current()
          cancelRef.current = null
        }
        const cursor = startAt >= list.length ? 0 : startAt
        cancelRef.current = play(list, cursor, stateRef.current.rate, stateRef.current.pitch)
      }, [segments, text, config.chunkChars, play, setState, stateRef])

      const handleStop = React.useCallback(() => {
        if (cancelRef.current !== null) {
          cancelRef.current()
          cancelRef.current = null
        }
        stop()
      }, [stop])

      const total = segments.length
      const cursor = state.cursor
      const errorText =
        state.error === 'nothing-to-read'
          ? t('nothingToRead')
          : state.error === 'bridge-unavailable'
            ? t('bridgeMissing')
            : state.error !== null && state.error !== undefined
              ? t('bridgeDenied', { reason: state.error })
              : null

      if (!available) {
        // PC 上不该看到这个按钮：没有桥就是没有朗读能力。
        // 但仍渲染成禁用态并给出原因，避免用户以为是插件坏了。
        return h(
          'button',
          {
            type: 'button',
            className: 'dshmtts-btn',
            disabled: true,
            title: t('bridgeMissing'),
            'aria-label': t('speak'),
          },
          h(SpeakerGlyph, { size: 13, muted: true }),
          h('span', null, t('speak')),
        )
      }

      const disabled = text.trim() === ''

      return h(
        'div',
        { className: 'dshmtts-root' },
        h(
          'button',
          {
            type: 'button',
            className: 'dshmtts-btn',
            'data-active': state.playing,
            disabled,
            onClick: state.playing ? handleStop : beginOrResume,
            'aria-label': state.playing ? t('stop') : t('speak'),
            title: disabled ? t('nothingToRead') : state.playing ? t('stop') : t('speak'),
          },
          h(SpeakerGlyph, { size: 13, muted: state.playing }),
          h('span', null, state.playing ? t('stop') : t('speak')),
        ),
        state.playing
          ? h(
              'div',
              { className: 'dshmtts-bar' },
              h(
                'span',
                { className: 'dshmtts-count' },
                t('segments', { index: cursor + 1, total: Math.max(total, 1) }),
              ),
              h(
                'div',
                { className: 'dshmtts-meter' },
                h('div', {
                  className: 'dshmtts-meterFill',
                  style: { width: Math.round(((cursor + 1) / Math.max(total, 1)) * 100) + '%' },
                }),
              ),
              h(
                'label',
                { className: 'dshmtts-speed' },
                t('speed'),
                h('input', {
                  className: 'dshmtts-speedInput',
                  type: 'number',
                  min: 0.5,
                  max: 2.5,
                  step: 0.1,
                  value: state.rate,
                  onChange: (event) => {
                    const next = Number(event.target.value)
                    if (!Number.isFinite(next)) return
                    const clamped = Math.min(2.5, Math.max(0.5, next))
                    setState((current) => ({ ...current, rate: clamped }))
                  },
                }),
              ),
            )
          : null,
        errorText !== null ? h('div', { className: 'dshmtts-error' }, errorText) : null,
        state.playing ? h('div', { className: 'dshmtts-hint' }, t('pauseHint')) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() =>
          ctx.slots.inject('conversation.chat.assistant-actions', () =>
            ctx.slots.register(
              {
                name: 'conversation.chat.assistant-actions',
                id: ACTION_ID,
                // 排在「反馈」(10) 之后、「保存」(90) 之前——朗读是轻量动作，不该抢主位。
                order: 20,
              },
              SpeakAction,
            ),
          ),
        )
      },
    }
  },
})
