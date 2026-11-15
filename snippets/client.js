/**
 * dsh-mobile-snippets — Client 半边。
 *
 * 在输入框左侧加一个「片段」按钮，点开是一列快捷提示词：
 * 点一条就填进输入框，右上角可增删。
 *
 * ## 为什么这是手机专属
 *
 * 手机上敲字很慢——打一句「请用简单的话解释一下上面这段内容」要半分钟，
 * 还容易按错。把这些常说的话存成片段，一点就有。PC 上有键盘，收益小得多。
 *
 * 生态里没有任何同类插件（本机 profile 里搜 `prompt|snippet|quick|shortcut` 全为空）。
 *
 * ## 插入方式的选择
 *
 * `inputActions` 提供三个写入口：
 * - `setDraft(text)`   整段替换
 * - `insertText(text, span)` 在光标处插入，但**要求 span.draftRev 与当前 rev 一致**，
 *   否则返回 false（并发保护）
 * - `submit()`         发送
 *
 * 默认用 `setDraft` 整段替换：手机上用户点"继续"就是想要输入框里只有"继续"，
 * 而不是追加在一段旧草稿后面。这符合手机的使用直觉。
 *
 * 不自动 `submit`——填进去让用户确认再发，避免误触直接发出去。
 */

window.__ModuleLoader__.load({
  id: '@dsh-mobile/snippets',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const SLOT_ID = 'dsh-mobile-snippets'
    const CONFIG_PATH = '/api/dsh-mobile-snippets/config'
    const SAVE_PATH = '/api/dsh-mobile-snippets/save'
    const STYLE_ATTR = 'data-dsh-mobile-snippets'

    /** 文案表。 */
    const DICTS = {
      zh: {
        button: '片段',
        panelTitle: '快捷提示词',
        empty: '还没有片段。点右上角 + 添加一条。',
        add: '添加',
        save: '保存',
        cancel: '取消',
        remove: '删除',
        titlePlaceholder: '名字，比如「精简」',
        textPlaceholder: '要填入输入框的内容',
        edit: '编辑',
        loadFailed: '读取片段失败',
        saveFailed: '保存失败：{reason}',
        noEditor: '这个配置里不能保存自定义片段',
        full: '已满 {max} 条，请先删旧的',
        hint: '点一条直接填入输入框，不会自动发送',
        needBoth: '名字和内容都要填',
      },
      en: {
        button: 'Snippets',
        panelTitle: 'Quick snippets',
        empty: 'No snippets yet. Tap + to add one.',
        add: 'Add',
        save: 'Save',
        cancel: 'Cancel',
        remove: 'Delete',
        titlePlaceholder: 'Name, e.g. “Shorter”',
        textPlaceholder: 'Text to put in the composer',
        edit: 'Edit',
        loadFailed: 'Could not load snippets',
        saveFailed: 'Save failed: {reason}',
        noEditor: 'This profile cannot persist custom snippets',
        full: 'Full ({max}). Delete one first.',
        hint: 'Tap one to fill the composer. It will not send automatically.',
        needBoth: 'Both name and text are required',
      },
    }

    /**
     * 取翻译器。
     * @returns 翻译函数。
     */
    function translator() {
      const lang = (() => {
        try {
          return (document.documentElement.lang || '').toLowerCase()
        } catch {
          return ''
        }
      })()
      const dict = lang.startsWith('en') ? DICTS.en : DICTS.zh
      return (key, vars) => {
        const text = dict[key] ?? key
        if (vars === undefined) return text
        return text.replace(/\{(\w+)\}/g, (whole, name) =>
          vars[name] !== undefined ? String(vars[name]) : whole,
        )
      }
    }

    /** 注入样式（只用主题 token）。 */
    function useStyles() {
      React.useEffect(() => {
        if (document.querySelector('style[' + STYLE_ATTR + ']') !== null) return undefined
        const style = document.createElement('style')
        style.setAttribute(STYLE_ATTR, '')
        style.textContent = [
          '.dshmsnip-wrap{position:relative;display:inline-flex}',
          '.dshmsnip-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;border:0;border-radius:13px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:1;cursor:pointer}',
          '@media (hover:hover){.dshmsnip-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
          '.dshmsnip-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
          '.dshmsnip-btn[data-open=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
          // 面板用 fixed 并 portal 到 body：输入框是 docked composer，容器会裁掉溢出。
          '.dshmsnip-panel{position:fixed;z-index:1200;box-sizing:border-box;width:min(320px,calc(100vw - 24px));max-height:min(60vh,420px);display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));box-shadow:var(--dsw-elevation-prominent);overflow:hidden}',
          '.dshmsnip-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2);flex:none}',
          '.dshmsnip-headTitle{font-size:13px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-primary)}',
          '.dshmsnip-headActions{display:inline-flex;gap:2px;flex:none}',
          '.dshmsnip-iconBtn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer}',
          '@media (hover:hover){.dshmsnip-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
          '.dshmsnip-list{flex:1;min-height:0;overflow-y:auto;padding:4px}',
          '.dshmsnip-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;min-height:40px;padding:6px 8px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}',
          '@media (hover:hover){.dshmsnip-item:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
          '.dshmsnip-itemBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
          '.dshmsnip-itemTitle{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
          '.dshmsnip-itemText{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
          '.dshmsnip-itemTools{flex:none;display:inline-flex;gap:2px}',
          '.dshmsnip-empty{padding:20px 14px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:center}',
          '.dshmsnip-foot{flex:none;padding:8px 12px;border-top:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
          '.dshmsnip-err{flex:none;padding:8px 12px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}',
          '.dshmsnip-form{display:flex;flex-direction:column;gap:8px;padding:10px 12px}',
          '.dshmsnip-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}',
          '.dshmsnip-textarea{box-sizing:border-box;width:100%;min-height:76px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:19px;resize:vertical}',
          '.dshmsnip-input:focus,.dshmsnip-textarea:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
          '.dshmsnip-formActions{display:flex;justify-content:flex-end;gap:8px}',
          '.dshmsnip-primary{height:30px;padding:0 14px;border:0;border-radius:15px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);font:inherit;font-size:13px;cursor:pointer}',
          '.dshmsnip-ghost{height:30px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:15px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}',
          '.dshmsnip-primary:disabled{opacity:.5;cursor:default}',
        ].join('\n')
        document.head.appendChild(style)
        return () => style.remove()
      }, [])
    }

    /**
     * 调只读端点取片段。
     * @returns `{snippets, maxCustom}` 或 null。
     */
    async function loadConfig() {
      try {
        const response = await fetch(CONFIG_PATH, { headers: { accept: 'application/json' } })
        if (!response.ok) return null
        const payload = await response.json()
        return {
          snippets: Array.isArray(payload?.snippets) ? payload.snippets : [],
          maxCustom: Number(payload?.maxCustom) || 40,
        }
      } catch {
        return null
      }
    }

    /**
     * 保存或删除一条片段。
     * @param action - `'save'` 或 `'remove'`。
     * @param snippet - 片段内容。
     * @returns `{ok, snippets?, message?}`。
     */
    async function saveSnippet(action, snippet) {
      try {
        const response = await fetch(SAVE_PATH, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ action, snippet }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          return { ok: false, message: payload?.message ?? payload?.code ?? String(response.status) }
        }
        return { ok: true, snippets: Array.isArray(payload?.snippets) ? payload.snippets : [] }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    }

    /**
     * 计算面板位置：贴着按钮上方或下方，并夹在视口内。
     *
     * 输入框在屏幕底部，所以默认向上弹；空间不够才向下。
     * @param anchor - 按钮的 DOM 元素。
     * @returns CSS 定位对象。
     */
    function panelPosition(anchor) {
      if (anchor === null || anchor === undefined) return { left: 12, bottom: 80 }
      try {
        const rect = anchor.getBoundingClientRect()
        const width = Math.min(320, window.innerWidth - 24)
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
        const spaceAbove = rect.top
        const spaceBelow = window.innerHeight - rect.bottom
        if (spaceAbove >= 240 || spaceAbove >= spaceBelow) {
          return { left, bottom: Math.round(window.innerHeight - rect.top + 6) }
        }
        return { left, top: Math.round(rect.bottom + 6) }
      } catch {
        return { left: 12, bottom: 80 }
      }
    }

    /**
     * 片段面板按钮（挂在输入框左侧）。
     * @param props - 槽位属性，含 `inputActions`。
     * @returns 控件元素。
     */
    function SnippetsButton(props) {
      useStyles()
      const t = translator()
      const [open, setOpen] = React.useState(false)
      const [snippets, setSnippets] = React.useState([])
      const [maxCustom, setMaxCustom] = React.useState(40)
      const [error, setError] = React.useState(null)
      const [editing, setEditing] = React.useState(null)
      const [position, setPosition] = React.useState({ left: 12, bottom: 80 })
      const btnRef = React.useRef(null)

      // 首次加载片段清单。失败就报错，但按钮仍可用（面板会显示空+提示）。
      React.useEffect(() => {
        let disposed = false
        void loadConfig().then((payload) => {
          if (disposed) return
          if (payload === null) {
            setError(t('loadFailed'))
            return
          }
          setSnippets(payload.snippets)
          setMaxCustom(payload.maxCustom)
        })
        return () => {
          disposed = true
        }
        // t 是每次渲染新建的纯函数，不放进依赖以免无限重跑。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // 打开时重算位置；窗口尺寸变化或滚动也重算，避免面板飘走。
      React.useEffect(() => {
        if (!open) return undefined
        const update = () => setPosition(panelPosition(btnRef.current))
        update()
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        return () => {
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
        }
      }, [open])

      // 点面板外部关闭。用捕获阶段，避免被输入框的 stopPropagation 吃掉。
      React.useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          const target = event.target
          if (!(target instanceof Node)) return
          if (btnRef.current !== null && btnRef.current.contains(target)) return
          const panel = document.querySelector('[data-dsh-snippets-panel]')
          if (panel !== null && panel.contains(target)) return
          setOpen(false)
          setEditing(null)
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('touchstart', onDown, true)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('touchstart', onDown, true)
        }
      }, [open])

      /**
       * 把片段填进输入框。
       *
       * 用 setDraft 整段替换：手机上点「继续」就是要输入框只有「继续」。
       * 不自动发送——让用户自己按发送键，避免误触。
       * @param text - 要填入的内容。
       */
      const fill = React.useCallback((text) => {
        try {
          props?.inputActions?.setDraft?.(text)
        } catch {
          // 输入法或编辑器未就绪时静默失败：面板关掉，用户能看出没填进去。
        }
        setOpen(false)
        setEditing(null)
      }, [props?.inputActions])

      const refresh = React.useCallback(async () => {
        const payload = await loadConfig()
        if (payload === null) {
          setError(t('loadFailed'))
          return
        }
        setSnippets(payload.snippets)
        setMaxCustom(payload.maxCustom)
        setError(null)
      }, [])

      const persist = React.useCallback(
        async (action, snippet) => {
          const result = await saveSnippet(action, snippet)
          if (!result.ok) {
            setError(
              result.message === 'dsh-mobile-snippets-no-editor'
                ? t('noEditor')
                : t('saveFailed', { reason: result.message ?? '?' }),
            )
            return false
          }
          setSnippets(result.snippets)
          setError(null)
          return true
        },
        [],
      )

      const full = snippets.length >= maxCustom

      return h(
        'div',
        { className: 'dshmsnip-wrap' },
        h(
          'button',
          {
            type: 'button',
            ref: btnRef,
            className: 'dshmsnip-btn',
            'data-open': open,
            onClick: () => {
              setPosition(panelPosition(btnRef.current))
              setOpen((value) => !value)
              setEditing(null)
            },
            'aria-label': t('button'),
            'aria-expanded': open,
            title: t('button'),
          },
          h(
            'svg',
            {
              width: 13,
              height: 13,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.8,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              'aria-hidden': true,
              style: { display: 'block' },
            },
            h('path', { d: 'M4 6h16M4 12h10M4 18h13' }),
          ),
          h('span', null, t('button')),
        ),
        open
          ? ReactPortal(
              h(
                'div',
                {
                  className: 'dshmsnip-panel',
                  'data-dsh-snippets-panel': '',
                  style: position,
                  role: 'dialog',
                  'aria-label': t('panelTitle'),
                },
                h(
                  'div',
                  { className: 'dshmsnip-head' },
                  h('span', { className: 'dshmsnip-headTitle' }, t('panelTitle')),
                  h(
                    'span',
                    { className: 'dshmsnip-headActions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshmsnip-iconBtn',
                        disabled: full && editing === null,
                        title: full ? t('full', { max: maxCustom }) : t('add'),
                        'aria-label': t('add'),
                        onClick: () => setEditing({ title: '', text: '' }),
                      },
                      '+',
                    ),
                  ),
                ),
                editing !== null
                  ? h(
                      'div',
                      { className: 'dshmsnip-form' },
                      h('input', {
                        className: 'dshmsnip-input',
                        value: editing.title,
                        placeholder: t('titlePlaceholder'),
                        onChange: (event) => setEditing({ ...editing, title: event.target.value }),
                      }),
                      h('textarea', {
                        className: 'dshmsnip-textarea',
                        value: editing.text,
                        placeholder: t('textPlaceholder'),
                        onChange: (event) => setEditing({ ...editing, text: event.target.value }),
                      }),
                      h(
                        'div',
                        { className: 'dshmsnip-formActions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dshmsnip-ghost',
                            onClick: () => setEditing(null),
                          },
                          t('cancel'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dshmsnip-primary',
                            disabled: editing.title.trim() === '' || editing.text.trim() === '',
                            onClick: async () => {
                              const ok = await persist('save', {
                                title: editing.title.trim(),
                                text: editing.text.trim(),
                              })
                              if (ok) setEditing(null)
                            },
                          },
                          t('save'),
                        ),
                      ),
                    )
                  : h(
                      'div',
                      { className: 'dshmsnip-list' },
                      snippets.length === 0
                        ? h('div', { className: 'dshmsnip-empty' }, t('empty'))
                        : snippets.map((snippet) =>
                            h(
                              'div',
                              { className: 'dshmsnip-item', key: snippet.title, role: 'group' },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'dshmsnip-itemBody',
                                  style: {
                                    border: 0,
                                    background: 'transparent',
                                    color: 'inherit',
                                    font: 'inherit',
                                    padding: 0,
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                  },
                                  onClick: () => fill(snippet.text),
                                  title: snippet.text,
                                },
                                h('span', { className: 'dshmsnip-itemTitle' }, snippet.title),
                                h('span', { className: 'dshmsnip-itemText' }, snippet.text),
                              ),
                              h(
                                'span',
                                { className: 'dshmsnip-itemTools' },
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'dshmsnip-iconBtn',
                                    'aria-label': t('edit'),
                                    title: t('edit'),
                                    onClick: () =>
                                      setEditing({ title: snippet.title, text: snippet.text }),
                                  },
                                  '✎',
                                ),
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'dshmsnip-iconBtn',
                                    'aria-label': t('remove'),
                                    title: t('remove'),
                                    onClick: async () => {
                                      const ok = await persist('remove', { title: snippet.title })
                                      if (ok) void refresh()
                                    },
                                  },
                                  '×',
                                ),
                              ),
                            ),
                          ),
                    ),
                error !== null ? h('div', { className: 'dshmsnip-err' }, error) : null,
                editing === null && error === null
                  ? h('div', { className: 'dshmsnip-foot' }, t('hint'))
                  : null,
              ),
            )
          : null,
      )
    }

    /**
     * 把节点渲染到 body。
     *
     * 必须 portal：输入框是 docked composer，祖先容器有 overflow 裁剪，
     * 面板直接渲染在里面会被切掉（`references/practices.md` 明确要求）。
     * React 18 的 `createPortal` 从 `react-dom` 取；取不到时退回直接渲染，
     * 至少不崩（可能被裁，但功能还在）。
     * @param node - 要渲染的节点。
     * @returns 渲染结果。
     */
    function ReactPortal(node) {
      try {
        const reactDom = require('react-dom')
        if (typeof reactDom?.createPortal === 'function') {
          return reactDom.createPortal(node, document.body)
        }
      } catch {
        // react-dom 不在模块表里时退回直接渲染。
      }
      return node
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() =>
          ctx.slots.inject('conversation.input.left', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.left',
                id: SLOT_ID,
                // 1000 是 mnemon 技能按钮占的位置；片段放它前面，离手更近。
                order: 500,
              },
              SnippetsButton,
            ),
          ),
        )
      },
    }
  },
})
