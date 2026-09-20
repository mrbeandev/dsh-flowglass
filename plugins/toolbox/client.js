
return {
  name: 'toolbox',
  inject: ['timer', 'sessions'],
  apply(ctx) {
    const RT = TOOLBOX_RUNTIME
    // Full bundle names are useful for tooltips and accessibility, but they
    // are too long for the drawer/sidebar chrome. Keep the descriptive name
    // as the accessible label and use a compact visible label in the UI.
    const fullDisplayName = String(RT.displayName || 'Toolbox')
    const compactDisplayName = fullDisplayName.length > 24
      ? 'Toolbox'
      : fullDisplayName
    const flowMarkdownText = RT.bundleId === 'flowglass-en'
      && typeof TOOLBOX_MARKDOWN_TEXT !== 'undefined'
      // React.memo / forwardRef components are objects, while ordinary
      // function components are functions. MarkdownText currently uses memo.
      && (typeof TOOLBOX_MARKDOWN_TEXT === 'function'
        || (TOOLBOX_MARKDOWN_TEXT && typeof TOOLBOX_MARKDOWN_TEXT === 'object'))
      ? TOOLBOX_MARKDOWN_TEXT : null
    const flowCreatePortal = RT.bundleId === 'flowglass-en'
      && typeof TOOLBOX_CREATE_PORTAL !== 'undefined'
      && typeof TOOLBOX_CREATE_PORTAL === 'function'
      ? TOOLBOX_CREATE_PORTAL : null
    const flowUiPrimitives = RT.bundleId === 'flowglass-en'
      && typeof TOOLBOX_UI_PRIMITIVES !== 'undefined'
      && TOOLBOX_UI_PRIMITIVES
      ? TOOLBOX_UI_PRIMITIVES : null
    // Client-side fallback for a split reload: DSH can hot-reload client.js
    // while the native Host half stays resident until process restart.
    const FLOW_COPY_ICON_HTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"></rect><path d="M3 11H2.5A1.5 1.5 0 0 1 1 9.5v-7A1.5 1.5 0 0 1 2.5 1h7A1.5 1.5 0 0 1 11 2.5V3"></path></svg>'
    const FLOW_PREVIEW_ICON_HTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4S1.5 8 1.5 8Z"></path><circle cx="8" cy="8" r="1.8"></circle></svg>'
    // DSH alpha.2 uses labels.code while the rc.2 primitive uses codeLabels.
    // Keep both shapes stable so the renderer can be shared across either host.
    const FLOW_MARKDOWN_LABELS = Object.freeze({
      code: Object.freeze({ copyLabel: 'Copy code', copiedLabel: 'Copy' }),
      footnotes: 'Footnotes',
    })
    const myDomId = RT.domMountedValue()
    if (typeof document !== 'undefined' && document.body) {
      const cur = (document.body.getAttribute('data-dsh-toolbox-mounted') || '').split(/\s+/).filter(Boolean)
      if (cur.indexOf(myDomId) >= 0) {
        console.log('toolbox: thisToolboxdrawer (session),thissession Client Skipped')
        return
      }
      document.body.setAttribute('data-dsh-toolbox-mounted', cur.concat([myDomId]).join(' '))
      ctx.effect(() => () => {
        try {
          if (!document.body) return
          const rest = (document.body.getAttribute('data-dsh-toolbox-mounted') || '').split(/\s+/).filter((v) => v && v !== myDomId)
          if (rest.length) document.body.setAttribute('data-dsh-toolbox-mounted', rest.join(' '))
          else document.body.removeAttribute('data-dsh-toolbox-mounted')
        } catch (e) {}
      })
    }
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const themeSvc = ctx.get('theme')
    const sessionsClient = ctx.sessions
    const workspacesClient = ctx.get('workspaces')

    const navigateHarnessSession = async (request) => {
      if (!request || !request.sessionId) return
      if (!sessionsClient) throw new Error('sessions unavailable')
      const target = String(request.sessionId)
      const parent = request.parentSessionId ? String(request.parentSessionId) : ''
      let navigationTarget = target
      if (request.kind === 'subagent' && parent) {
        let address = typeof sessionsClient.subagentAddress === 'function' ? sessionsClient.subagentAddress(target) : null
        if (!address && typeof sessionsClient.refreshSubagents === 'function') {
          try { await sessionsClient.refreshSubagents(parent) } catch (e) {}
          if (typeof sessionsClient.subagentAddress === 'function') address = sessionsClient.subagentAddress(target)
        }
        if (!address && sessionsClient.list && typeof sessionsClient.list.getSnapshot === 'function') {
          const snap = sessionsClient.list.getSnapshot()
          const catalog = snap && snap.subagentsByParent && snap.subagentsByParent[parent]
          const entry = catalog && Array.isArray(catalog.entries)
            ? catalog.entries.find((it) => it && it.kind === 'child' && it.id === target)
            : null
          if (entry && entry.mode) address = { parentSessionId: parent, childSessionId: target, mode: entry.mode }
        }
        if (address) navigationTarget = address
      }
      const uiWorkspace = ctx.get('uiWorkspace')
      if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
        uiWorkspace.openSession(navigationTarget)
        return
      }
      if (navigationTarget !== target && typeof sessionsClient.openSubagent === 'function') {
        sessionsClient.openSubagent(navigationTarget)
        return
      }
      if (typeof sessionsClient.open !== 'function') throw new Error('sessions.open unavailable')
      sessionsClient.open(target)
    }

    const SESSION_EVENT = RT.event('session-changed')
    try {
      if (typeof localStorage !== 'undefined' && typeof window !== 'undefined') {
        const proto = Object.getPrototypeOf(localStorage)
        let orig = proto && proto.setItem
        if (orig && orig.__tbPatched && orig.__tbEvents) {
          orig.__tbEvents.add(SESSION_EVENT)
          const shared = orig
          ctx.effect(() => () => {
            try {
              shared.__tbEvents.delete(SESSION_EVENT)
              if (!shared.__tbEvents.size && proto.setItem === shared && shared.__tbOrig) proto.setItem = shared.__tbOrig
            } catch (e) {}
          })
        } else if (orig && !orig.__tbPatched) {
          const events = new Set([SESSION_EVENT])
          const wrapped = function (k, v) {
            const r = orig.apply(this, arguments)
            try { if (k === 'dsh.sessions.current') { for (const ev of events) window.dispatchEvent(new CustomEvent(ev, { detail: v })) } } catch (e) {}
            return r
          }
          wrapped.__tbPatched = true
          wrapped.__tbEvents = events
          wrapped.__tbOrig = orig
          proto.setItem = wrapped
          ctx.effect(() => () => {
            try {
              events.delete(SESSION_EVENT)
              if (!events.size && proto.setItem === wrapped) proto.setItem = orig
            } catch (e) {}
          })
        }
      }
    } catch (e) {}

    const PANEL_HIDE_KEY = RT.bundleId === 'dynamic' ? 'tbx-hide-host-only' : 'tbx-hide-host-only-' + RT.bundleId
    const PANEL_HIDE_TOKEN = RT.domMountedValue()
    const tokenList = (el, attr) => (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean)
    const setOwnToken = (el, attr, on) => {
      const next = tokenList(el, attr).filter((v) => v !== PANEL_HIDE_TOKEN)
      if (on) next.push(PANEL_HIDE_TOKEN)
      if (next.length) el.setAttribute(attr, next.join(' '))
      else el.removeAttribute(attr)
    }
    const panelHide = {
      on: (() => { try { return localStorage.getItem(PANEL_HIDE_KEY) !== '0' } catch (e) { return true } })(),
      headless: new Set(),
    }
    const panelHideSupported = RT.capabilities.managePlugins !== false
    if (panelHideSupported) ctx.effect(() => styles.insert([
      'li[data-cordis-row][data-tb-hide~="' + PANEL_HIDE_TOKEN + '"]{display:none!important}',
      '[data-cordis-panel] section[data-tb-hide~="' + PANEL_HIDE_TOKEN + '"]{display:none!important}',
      'button[data-cordis-badge] span[data-tb-count]{font-size:0!important}',
      'button[data-cordis-badge] span[data-tb-count]::after{content:attr(data-tb-count);font-size:calc(12px*var(--tb-fs,1));line-height:16px}',
    ].join('')))
    function applyPanelHide() {
      if (typeof document === 'undefined' || !document.body) return
      const rows = document.querySelectorAll('li[data-cordis-row]')
      for (const li of rows) {
        const hide = panelHide.on && panelHide.headless.has(li.getAttribute('data-cordis-row')) && !li.hasAttribute('data-cordis-awaiting')
        setOwnToken(li, 'data-tb-hide', hide)
      }
      const panel = document.querySelector('[data-cordis-panel]')
      if (panel) for (const sec of panel.querySelectorAll('section')) {
        const lis = sec.querySelectorAll('li[data-cordis-row]')
        let vis = 0
        for (const li of lis) if (!li.hasAttribute('data-tb-hide')) vis++
        setOwnToken(sec, 'data-tb-hide', lis.length > 0 && vis === 0)
      }
      const badge = document.querySelector('button[data-cordis-badge]')
      if (!badge) return
      let visibleRunning = null
      if (rows.length) {
        visibleRunning = 0
        for (const li of rows) {
          if (!li.hasAttribute('data-tb-hide') && li.getAttribute('data-cordis-status') === 'running') visibleRunning++
        }
      }
      for (const sp of badge.querySelectorAll('span')) {
        if (!/^\s*\d+\s+running\s*$/.test(sp.textContent || '') && !sp.hasAttribute('data-tb-count')) continue
        if (panelHide.on && visibleRunning !== null) {
          const txt = visibleRunning + ' running'
          if (sp.getAttribute('data-tb-count') !== txt) sp.setAttribute('data-tb-count', txt)
        } else if (sp.hasAttribute('data-tb-count')) sp.removeAttribute('data-tb-count')
      }
    }
    let panelHideRaf = 0
    function schedulePanelHide() {
      if (panelHideRaf) return
      panelHideRaf = requestAnimationFrame(() => { panelHideRaf = 0; applyPanelHide() })
    }
    async function refreshPanelHide() {
      try {
        const r = await host.call(RT.rpc('plugins'), {})
        if (!r || !r.ok || !Array.isArray(r.plugins)) return
        panelHide.headless = new Set(r.plugins.filter((p) => !p.hasClientHalf).map((p) => p.pluginId))
        applyPanelHide()
      } catch (e) {}
    }
    function setPanelHideOn(v) {
      panelHide.on = v
      try { localStorage.setItem(PANEL_HIDE_KEY, v ? '1' : '0') } catch (e) {}
      if (v) refreshPanelHide()
      applyPanelHide()
    }
    if (panelHideSupported && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
      const mo = new MutationObserver(schedulePanelHide)
      mo.observe(document.body, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['data-cordis-awaiting', 'data-cordis-row', 'data-cordis-badge'],
      })
      ctx.effect(() => () => mo.disconnect())
      const phIv = setInterval(() => {
        if (!panelHide.on) return
        try { if (typeof document !== 'undefined' && document.hidden) return } catch (e) {}
        refreshPanelHide()
      }, 10000)
      ctx.effect(() => () => clearInterval(phIv))
      refreshPanelHide()
      applyPanelHide()
    }

    const toolboxCss = [
      '.tb-entry{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;margin:0 4px 0 0;border:1px solid var(--dsw-alias-border-l2,#4a4b55);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#26272e);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:calc(12px*var(--tb-fs,1));font-weight:600;line-height:1;cursor:pointer;white-space:nowrap;appearance:none;box-sizing:border-box;font-family:inherit}',
      '.tb-entry:hover{background:var(--dsw-alias-bg-layer-2,#30313a)}',
      '.tb-entry-active{color:var(--dsw-alias-brand-primary,#3b82f6);border-color:var(--dsw-alias-brand-primary,#3b82f6)}',
      '[data-dsh-toolbox-entry]{width:100%;height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:0 12px;font-size:calc(13px*var(--tb-fs,1));display:flex;font-family:inherit;box-sizing:border-box}',
      '[data-dsh-toolbox-entry]:hover{background:var(--dsw-specific-sidebar-nav-item-hover,var(--dsw-alias-bg-layer-2,#31323b));color:var(--dsw-alias-label-primary)}',
      '[data-dsh-toolbox-entry][data-active]{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-bg-layer-2,#31323b));color:var(--dsw-alias-label-primary);font-weight:600}',
      '.tb-nav-icon{flex:none;display:inline-flex;justify-content:center;align-items:center}',
      '.tb-nav-label{overflow:hidden;text-overflow:ellipsis}',
      '[data-dsh-frame][data-sidebar-collapsed] [data-dsh-toolbox-entry]{justify-content:center;width:100%;padding:0}',
      '[data-dsh-frame][data-sidebar-collapsed] .tb-nav-label{display:none}',
      '[data-sidebar-collapsed] [data-dsh-toolbox-entry]{justify-content:center;width:100%;padding:0}',
      '[data-sidebar-collapsed] .tb-nav-label{display:none}',
      '.jr-drawer{position:fixed;right:24px;top:64px;z-index:1300;width:520px;max-width:94vw;max-height:calc(100vh - 96px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#17181d);border:1px solid var(--dsw-alias-border-l1,#3a3b44);border-radius:10px;color:var(--dsw-alias-label-primary,#e8e8ea);font-size:calc(13px*var(--tb-fs,1));pointer-events:auto;box-shadow:-14px 0 44px rgba(0,0,0,.24);animation:jrDrawerIn .16s ease-out;overflow:hidden}',
      '.jr-drawer-embedded{position:relative;inset:auto;z-index:auto;width:100%;height:100%;min-height:0;max-width:none;max-height:none;border:0;border-radius:0;background:transparent;box-shadow:none;animation:none;overflow:hidden}',
      '.jr-drawer-embedded .jr-drawer-body{flex:1;min-height:0;padding:8px}',
      '.jr-docked{right:0;top:0;bottom:0;max-height:none;border-radius:0;border-top:none;border-right:none;border-bottom:none;border-left:1px solid var(--dsw-alias-border-l1,#3a3b44);box-shadow:-8px 0 24px rgba(0,0,0,.16)}',
      '.jr-docked .jr-drawer-body{flex:1;min-height:0}',
      '.jr-docked-full{right:0;top:0;bottom:0;max-height:none;max-width:none;width:auto;border-radius:0;border:none;border-left:1px solid var(--dsw-alias-border-l1,#3a3b44);box-shadow:none;animation:jrDrawerIn .16s ease-out}',
      '.jr-docked-full .jr-drawer-body{flex:1;min-height:0}',
      '@keyframes jrDrawerIn{from{transform:translateX(28px);opacity:.3}to{transform:translateX(0);opacity:1}}',
      '@keyframes jrDrawerUp{from{transform:translateY(9px);opacity:0}to{transform:translateY(0);opacity:1}}',
      '.jr-drawer-header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3b44);background:var(--dsw-alias-bg-base,#17181d);cursor:move;user-select:none}',
      '.jr-drawer-title{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:calc(14px*var(--tb-fs,1))}',
      '.jr-overlay-close{width:30px;height:30px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9aa5);cursor:pointer;border-radius:6px;padding:0}',
      '.jr-overlay-close:hover{color:var(--dsw-alias-label-primary,#e8e8ea);background:var(--dsw-alias-bg-layer-2,#30313a)}',
      '.jr-drawer-body{padding:14px;overflow:auto;display:flex;flex-direction:column;gap:12px}',
      '.jr-drawer *{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#454650) transparent}',
      '.jr-drawer ::-webkit-scrollbar{width:9px;height:9px}',
      '.jr-drawer ::-webkit-scrollbar-track{background:transparent}',
      '.jr-drawer ::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#454650);border-radius:5px;border:2px solid transparent;background-clip:padding-box}',
      '.jr-drawer ::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-tertiary,#6f707c);border:2px solid transparent;background-clip:padding-box}',
      '.jr-drawer ::-webkit-scrollbar-corner{background:transparent}',
      '.jr-tabpanel{display:flex;flex-direction:column;gap:12px}',
      '.tb-nav{display:flex;flex-direction:column;gap:8px;padding:10px 14px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3b44);flex:none}',
      '.tb-nav-search{flex:none;width:100%}',
      '.tb-hrow{display:flex;gap:6px;overflow-x:auto;scrollbar-width:thin}',
      '.tb-cats{padding-bottom:2px}',
      '.tb-tools{padding-bottom:9px}',
      '.tb-hrow-empty{flex:none;color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:calc(11.5px*var(--tb-fs,1));padding:2px 2px 10px}',
      '.tb-tab{flex:none;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:calc(12px*var(--tb-fs,1));font-weight:600;cursor:pointer;white-space:nowrap;appearance:none;font-family:inherit}',
      '.tb-tree-cat{display:flex;align-items:center;gap:7px;height:26px;padding:0 6px;border-radius:6px;cursor:pointer;user-select:none;border:1px dashed transparent;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-tree-cat:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b))}',
      '.tb-tree-cat-drop{border-color:var(--tb-accent-border,rgba(91,141,239,.5));background:var(--tb-accent-bg,rgba(91,141,239,.08))}',
      '.tb-tree-chev{width:12px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));transition:transform .12s}',
      '.tb-tree-cat-open>.tb-tree-chev{transform:rotate(90deg)}',
      '.tb-tree-cat-label{font-size:calc(12px*var(--tb-fs,1));font-weight:700;letter-spacing:.3px}',
      '.tb-tree-kids{display:flex;flex-direction:column;gap:6px;padding:2px 0 6px 19px}',
      '.tb-drag{flex:none;cursor:grab;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:calc(11px*var(--tb-fs,1));letter-spacing:1px;line-height:1}',
      '.tb-tab:hover{background:var(--dsw-alias-bg-layer-2,#30313a);color:var(--dsw-alias-label-primary,#e8e8ea)}',
      '.tb-tab-active{color:var(--dsw-alias-brand-primary,#3b82f6);border-color:var(--dsw-alias-border-l2,#4a4b55);background:var(--dsw-alias-bg-layer-1,#26272e)}',
      '.tb-tab-spin{display:inline-block;width:10px;height:10px;border:1.5px solid var(--tb-accent-border,rgba(91,141,239,.35));border-top-color:var(--tb-accent,#3f6fd9);border-radius:50%;animation:tbSpin .7s linear infinite}',
      '.tb-tab-badge{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;border-radius:999px;font-size:calc(9.5px*var(--tb-fs,1));font-weight:700;font-variant-numeric:tabular-nums;background:var(--tb-accent-bg,rgba(91,141,239,.16));color:var(--tb-accent-text,#7fa7f0);border:1px solid var(--tb-accent-border,rgba(91,141,239,.35))}',
      '@keyframes tbSpin{to{transform:rotate(360deg)}}',
      '.tb-empty{color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:calc(12px*var(--tb-fs,1));text-align:center;padding:26px 0;line-height:1.7}',
      '.jr-snap-indicator{position:fixed;right:0;top:0;bottom:0;width:4px;background:var(--dsw-alias-brand-primary,#3b82f6);opacity:.65;z-index:1299;pointer-events:none}',
      '.jr-resize-left{position:absolute;left:0;top:0;bottom:0;width:6px;cursor:col-resize;z-index:6;touch-action:none}',
      '.jr-resize-left:hover{background:rgba(59,130,246,.28)}',
      '.jr-resize-right{position:absolute;top:0;right:0;bottom:0;width:6px;cursor:ew-resize;z-index:6;touch-action:none}',
      '.jr-resize-right:hover{background:rgba(59,130,246,.28)}',
      '.jr-resize-bottom{position:absolute;left:0;right:0;bottom:0;height:6px;cursor:ns-resize;z-index:6;touch-action:none}',
      '.jr-resize-bottom:hover{background:rgba(59,130,246,.28)}',
      '.jr-resize-corner{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:6;touch-action:none}',
      '.jr-resize-corner:hover{background:rgba(59,130,246,.22);border-radius:0 0 10px 0}',
      '.jr-resize-badge{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);padding:5px 12px;border:1px solid var(--dsw-alias-border-l2,#4a4b55);border-radius:6px;background:var(--dsw-alias-bg-overlay,#1e1f24);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:calc(12px*var(--tb-fs,1));font-variant-numeric:tabular-nums;z-index:1310;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.3)}',
      '.tb-frame{position:relative;display:flex;flex-direction:column;gap:10px;min-height:0}',
      '.tb-jump-latest{position:absolute;right:16px;bottom:14px;z-index:7;display:inline-flex;align-items:center;height:28px;padding:0 13px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#454650);background:var(--dsw-alias-bg-overlay,#1e1f24);color:var(--tb-accent-text,#7fa7f0);font-size:calc(12px*var(--tb-fs,1));font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3);font-family:inherit;animation:jrDrawerUp .16s ease-out}',
      '.tb-jump-latest:hover{border-color:var(--tb-accent-border,rgba(91,141,239,.5));box-shadow:0 10px 26px rgba(0,0,0,.36),0 0 0 1px var(--tb-accent-ring,rgba(91,141,239,.16)),inset 0 1px 0 rgba(255,255,255,.12)}',
      '.tb-flow-zoom-float,.tb-flow-selection-bar{position:absolute;left:16px;bottom:14px;z-index:8;display:flex;align-items:center;gap:7px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:999px;background:var(--dsw-alias-bg-overlay,#1e1f24);box-shadow:0 4px 14px rgba(0,0,0,.3)}',
      '.tb-flow-zoom-float,.tb-flow-selection-bar{padding:3px 5px;opacity:.42;transition:opacity .15s}',
      '.tb-flow-zoom-float:hover,.tb-flow-zoom-float:focus-within,.tb-flow-selection-bar:hover,.tb-flow-selection-bar:focus-within{opacity:1}',
      '.tb-flow-zoom-float.with-selection{bottom:14px}',
      '.tb-flow-selection-bar{bottom:54px;flex-wrap:nowrap;white-space:nowrap}',
      '.tb-flow-zoom{display:inline-flex;align-items:center;gap:2px}',
      '.tb-flow-zoom-btn{width:25px;height:24px;border:none;border-radius:5px;background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));cursor:pointer;font-family:inherit}',
      '.tb-flow-zoom-btn:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-flow-zoom-value{min-width:43px;text-align:center;font-size:calc(11px*var(--tb-fs,1));font-variant-numeric:tabular-nums;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))}',
      '.tb-flow-select-btn{height:24px;padding:0 9px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font-size:calc(11px*var(--tb-fs,1));cursor:pointer;font-family:inherit}',
      '.tb-flow-icon-btn{position:relative;width:25px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:5px;background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));cursor:pointer;padding:0}',
      '.tb-flow-icon-btn:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-active-text,#7fa7f0)}',
      '.tb-flow-icon-btn:disabled{opacity:.4;cursor:default}',
      '.tb-flow-selection-count{width:24px;height:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:999px;background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font-size:calc(10.5px*var(--tb-fs,1));font-weight:600;font-variant-numeric:tabular-nums}',
      '.tb-flow-bring-popup{position:absolute;left:16px;bottom:94px;z-index:9;width:min(360px,calc(100% - 32px));display:flex;flex-direction:column;gap:9px;padding:10px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:9px;background:var(--dsw-alias-bg-overlay,#1e1f24);box-shadow:0 8px 24px rgba(0,0,0,.35);animation:jrDrawerUp .14s ease-out}',
      '.tb-flow-add-popup{position:fixed;right:auto;bottom:auto;z-index:60;box-sizing:border-box;overflow:hidden;border-color:color-mix(in srgb,var(--tb-active-text,#7fa7f0) 34%,transparent);background:linear-gradient(145deg,color-mix(in srgb,var(--dsw-alias-bg-overlay,#1e1f24) 52%,rgba(122,162,240,.17)),color-mix(in srgb,var(--dsw-alias-bg-overlay,#1e1f24) 34%,transparent));box-shadow:0 24px 70px rgba(0,0,0,.48),0 7px 24px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.11);backdrop-filter:blur(26px) saturate(175%);-webkit-backdrop-filter:blur(26px) saturate(175%);animation:jrDrawerUp .16s ease-out}',
      '.tb-flow-add-popup::before{content:"";position:absolute;inset:0 0 auto 0;height:1px;background:linear-gradient(90deg,transparent,rgba(151,184,248,.68),transparent);pointer-events:none}',
      '.tb-flow-add-popup .tb-flow-popup-head{padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,.07)}',
      '.tb-flow-add-popup .tb-flow-session-tree{flex:1;min-height:0;max-height:none}',
      '.tb-flow-add-popup .tb-flow-tree-workspace,.tb-flow-add-popup .tb-flow-tree-session{transition:background .14s ease,border-color .14s ease,transform .14s ease}',
      '.tb-flow-add-popup .tb-flow-tree-workspace:hover,.tb-flow-add-popup .tb-flow-tree-session:hover{background:color-mix(in srgb,var(--tb-active-text,#7fa7f0) 11%,transparent);transform:translateX(1px)}',
      '.tb-flow-add-popup .tb-flow-popup-actions{padding-top:8px;border-top:1px solid rgba(255,255,255,.07)}',
      '.tb-flow-popup-head{display:flex;align-items:center;gap:8px;font-size:calc(12px*var(--tb-fs,1));font-weight:600;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-flow-popup-head>span{flex:1}',
      '.tb-flow-popup-actions{display:flex;justify-content:flex-end;gap:7px}',
      '.tb-flow-session-tree{display:flex;flex-direction:column;gap:8px;max-height:300px;overflow:auto;padding-right:3px}',
      '.tb-flow-tree-group{display:flex;flex-direction:column;gap:3px}',
      '.tb-flow-tree-workspace{width:100%;height:29px;display:flex;align-items:center;gap:7px;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font-size:calc(10.5px*var(--tb-fs,1));font-weight:600;padding:0 6px;border:none;border-radius:6px;background:transparent;cursor:pointer;text-align:left;font-family:inherit}',
      '.tb-flow-tree-workspace:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-flow-tree-folder{flex:none;color:var(--tb-active-text,#7fa7f0)}',
      '.tb-flow-tree-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tb-flow-tree-count{flex:none;font-size:calc(9.5px*var(--tb-fs,1));opacity:.7}',
      '.tb-flow-tree-chevron{flex:none;font-size:calc(9px*var(--tb-fs,1));transition:transform .12s;opacity:.7}',
      '.tb-flow-tree-workspace.open .tb-flow-tree-chevron{transform:rotate(90deg)}',
      '.tb-flow-tree-session{height:28px;display:flex;align-items:center;gap:7px;margin-left:12px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));text-align:left;cursor:pointer;font-family:inherit;font-size:calc(11px*var(--tb-fs,1))}',
      '.tb-flow-tree-session:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-flow-tree-session.on{border-color:var(--tb-accent-border,rgba(91,141,239,.5));background:var(--tb-accent-bg,rgba(91,141,239,.10));color:var(--tb-active-text,#7fa7f0)}',
      '.tb-flow-tree-session>span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tb-flow-tree-id{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:calc(9.5px*var(--tb-fs,1));opacity:.72}',
      '.jr-drawer.jr-flow-zen{position:fixed!important;inset:0!important;z-index:1600!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;border:none!important;border-radius:0!important;box-shadow:none!important}',
      '.jr-flow-zen>.jr-drawer-header,.jr-flow-zen>.tb-nav{display:none!important}',
      '.jr-flow-zen>.jr-drawer-body{flex:1;min-height:0;padding:10px!important}',
      '.tb-flow-session-select{height:25px;max-width:180px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:calc(11px*var(--tb-fs,1));padding:0 6px;font-family:inherit}',
      '.tb-flow-toolbar-note{font-size:calc(11px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}',
      '.jr-pip-root{display:flex;flex-direction:column;height:100vh;background:var(--dsw-alias-bg-base,#17181d);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:calc(13px*var(--tb-fs,1));overflow:hidden;font-family:inherit}',
      '.jr-pip-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3b44);background:var(--dsw-alias-bg-layer-1,#26272e)}',
      '.jr-pip-bar-title{flex:1;min-width:0;font-size:calc(11.5px*var(--tb-fs,1));color:var(--dsw-alias-label-secondary,#9a9aa5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.jr-pip-bar-btn{flex:none;height:24px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#454650);background:transparent;color:var(--dsw-alias-label-primary,#e8e8ea);font-size:calc(11.5px*var(--tb-fs,1));cursor:pointer;font-family:inherit}',
      '.jr-pip-bar-btn:hover{background:var(--dsw-alias-bg-layer-2,#30313a)}',
      '.jr-pip-mirror{flex:1;min-height:0;overflow:hidden;position:relative}',
      '.jr-pip-mirror .jr-drawer{display:flex}',
      '.jr-pip-mirror .jr-resize-left,.jr-pip-mirror .jr-resize-right,.jr-pip-mirror .jr-resize-bottom,.jr-pip-mirror .jr-resize-corner,.jr-pip-mirror .jr-snap-indicator,.jr-pip-mirror .jr-resize-badge{display:none}',
      '.jr-pip-root *{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#454650) transparent}',
      '.jr-pip-root ::-webkit-scrollbar{width:9px;height:9px}',
      '.jr-pip-root ::-webkit-scrollbar-track{background:transparent}',
      '.jr-pip-root ::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#454650);border-radius:5px;border:2px solid transparent;background-clip:padding-box}',
      '.tb-notice{color:var(--dsw-alias-label-secondary,#9a9aa5);font-size:calc(12px*var(--tb-fs,1));text-align:center;padding:8px 0}',
      '.tb-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:calc(12px*var(--tb-fs,1));white-space:pre-wrap;word-break:break-word;border:1px solid var(--dsw-alias-border-l1,#3a3b44);border-radius:6px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1,#26272e)}',
      '.tb-root{font-size:calc(12.5px*var(--tb-fs,1));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-root *{box-sizing:border-box}',
      '.tb-btn{display:inline-flex;align-items:center;justify-content:center;height:var(--tb-ctl-h-sm,26px);padding:0 11px;border-radius:6px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650))!important;background:transparent!important;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))!important;font-size:calc(12px*var(--tb-fs,1));font-weight:500;font-family:inherit;line-height:1;cursor:pointer;white-space:nowrap;appearance:none;-webkit-appearance:none;outline:none;margin:0;box-shadow:none;text-shadow:none;transition:background .12s,border-color .12s,color .12s}',
      '.tb-btn:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b))!important}',
      '.tb-btn:active{transform:translateY(1px)}',
      '.tb-btn:disabled{opacity:.4;cursor:default;transform:none}',
      '.tb-btn-primary{background:var(--tb-accent,#3f6fd9)!important;border-color:var(--tb-accent,#3f6fd9)!important;color:#fff!important}',
      '.tb-btn-primary:hover{background:var(--tb-accent-hover,#4c7ceb)!important;border-color:var(--tb-accent-hover,#4c7ceb)!important}',
      '.tb-btn-ghost{border-color:transparent!important;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))!important}',
      '.tb-btn-ghost:hover{color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))!important}',
      '.tb-btn-danger-ghost{border-color:transparent!important;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))!important}',
      '.tb-btn-danger-ghost:hover{background:var(--tb-danger-bg,rgba(239,83,80,.1))!important;color:var(--tb-danger-text,#f28b82)!important}',
      '.tb-btn-sm{height:23px;padding:0 8px;font-size:calc(11.5px*var(--tb-fs,1))}',
      '.tb-query{display:flex;gap:8px;align-items:center}',
      '.tb-query .tb-btn{height:var(--tb-ctl-h,30px)}',
      '.tb-input{flex:1 1 auto;min-width:0;height:var(--tb-ctl-h,30px);padding:0 11px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:calc(12.5px*var(--tb-fs,1));outline:none;font-family:inherit;caret-color:var(--tb-accent,#3f6fd9);transition:border-color .12s,box-shadow .12s}',
      '.tb-input:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.tb-input:focus{border-color:var(--tb-accent,#3f6fd9);box-shadow:0 0 0 3px var(--tb-accent-ring,rgba(91,141,239,.16))}',
      '.tb-input::placeholder{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.tb-textarea{width:100%;min-height:62px;padding:8px 11px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:calc(12px*var(--tb-fs,1));font-family:ui-monospace,Consolas,monospace;line-height:1.55;outline:none;resize:vertical;box-sizing:border-box;caret-color:var(--tb-accent,#3f6fd9)}',
      '.tb-textarea:focus{border-color:var(--tb-accent,#3f6fd9);box-shadow:0 0 0 3px var(--tb-accent-ring,rgba(91,141,239,.16))}',
      '.tb-textarea::placeholder{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.tb-select{height:var(--tb-ctl-h-sm,26px);padding:0 8px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:calc(12px*var(--tb-fs,1));font-family:inherit;outline:none;cursor:pointer}',
      '.tb-chips{display:flex;gap:5px;flex-wrap:wrap}',
      '.tb-chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font-size:calc(11px*var(--tb-fs,1));font-weight:500;cursor:pointer;white-space:nowrap;font-family:inherit;transition:border-color .12s,color .12s,background .12s}',
      '.tb-chip:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-chip-on{background:var(--tb-accent-bg,rgba(91,141,239,.14));border-color:var(--tb-accent-border,rgba(91,141,239,.45));color:var(--tb-accent-text,#7fa7f0)}',
      '.tb-stats{display:flex;gap:8px;flex-wrap:wrap}',
      '.tb-stat{flex:1;min-width:70px;display:flex;flex-direction:column;gap:2px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;padding:7px 10px}',
      '.tb-stat-num{font-size:calc(15px*var(--tb-fs,1));font-weight:700;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-variant-numeric:tabular-nums}',
      '.tb-stat-label{font-size:calc(10.5px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.jr-drawer-body:has(.tb-pane){overflow:hidden}',
      '.tb-frame:has(.tb-pane){flex:1;min-height:0;overflow:hidden}',
      '.tb-frame>.tb-panel-html{flex:1;min-height:0;display:flex;flex-direction:column}',
      '.tb-pane{position:relative;display:flex;flex-direction:column;flex:1;min-height:0;gap:10px;overflow:hidden}',
      '.tb-pane-head{flex:none;display:flex;flex-direction:column;gap:10px}',
      '.tb-pane-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column-reverse;gap:4px;padding-right:4px}',
      '.tb-pane-col{flex-direction:column}',
      '.tb-banner{padding:7px 11px;border-radius:6px;font-size:calc(12px*var(--tb-fs,1));line-height:1.6;white-space:pre-wrap;word-break:break-word;border:1px solid}',
      '.tb-banner-error{color:var(--tb-danger-text,#f2b8b5);background:var(--tb-danger-bg,rgba(239,83,80,.07));border-color:var(--tb-danger-border,rgba(239,83,80,.25))}',
      '.tb-banner-info{color:var(--tb-ok-text,#a5d6a7);background:var(--tb-ok-bg,rgba(102,187,106,.07));border-color:var(--tb-ok-border,rgba(102,187,106,.25))}',
      '.tb-dot{flex:none;width:6px;height:6px;border-radius:50%}',
      '.tb-dot-done{background:var(--tb-done,#66bb6a)}',
      '.tb-dot-active{background:var(--tb-active,#5b8def)}',
      '.tb-dot-todo{background:var(--tb-muted,#8a8b96)}',
      '.tb-dot-other{background:var(--tb-warn,#d4a72c)}',
      '.tb-pill{display:inline-flex;align-items:center;gap:5px;height:19px;padding:0 8px;border-radius:999px;font-size:calc(11px*var(--tb-fs,1));border:1px solid;white-space:nowrap}',
      '.tb-pill-done{color:var(--tb-done-text,#81c784);border-color:var(--tb-done-border,rgba(102,187,106,.35))}',
      '.tb-pill-active{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-active-border,rgba(91,141,239,.4))}',
      '.tb-pill-todo{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));border-color:var(--tb-muted-border,rgba(138,139,150,.35))}',
      '.tb-pill-other{color:var(--tb-warn-text,#d4b95c);border-color:var(--tb-warn-border,rgba(212,167,44,.4))}',
      '.tb-pill-warn{color:var(--tb-warn-text,#d4b95c);border-color:var(--tb-warn-border,rgba(212,167,44,.4))}',
      '.tb-pill-plain{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));border-color:var(--tb-border-2,var(--dsw-alias-border-l2,#454650))}',
      '.tb-pill-btn{display:inline-flex;align-items:center;gap:5px;height:19px;padding:0 8px;border-radius:999px;font-size:calc(11px*var(--tb-fs,1));white-space:nowrap;font-family:inherit;line-height:1;background:transparent;border:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650));color:var(--tb-text-3,#8b8c96);cursor:pointer}',
      '.tb-pill-btn:hover{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-active-border,rgba(91,141,239,.4))}',
      '.tb-pill-btn.on{color:var(--tb-active-text,#7fa7f0);border:1px solid var(--tb-active-border,rgba(91,141,239,.4));background:var(--tb-active-bg,rgba(91,141,239,.08))}',
      '.tb-tx-done{color:var(--tb-done-text,#81c784)}',
      '.tb-tx-active{color:var(--tb-active-text,#7fa7f0)}',
      '.tb-tx-warn{color:var(--tb-warn-text,#d4b95c)}',
      '.tb-tx-danger{color:var(--tb-danger-text,#f28b82)}',
      '.tb-tx-muted{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-mono{font-family:ui-monospace,Consolas,monospace}',
      '.tb-num{font-variant-numeric:tabular-nums;font-size:calc(11px*var(--tb-fs,1));flex:none}',
      '.tb-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.tb-hr{height:1px;background:var(--tb-border,var(--dsw-alias-border-l1,#35363e))}',
      '.tb-note{font-size:calc(11.5px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-card{display:flex;flex-direction:column;gap:12px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:10px;padding:13px 14px}',
      '.tb-card-head{display:flex;align-items:flex-start;gap:9px}',
      '.tb-key{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;background:var(--tb-accent-bg,rgba(91,141,239,.12));color:var(--tb-accent-text,#7fa7f0);font-family:ui-monospace,Consolas,monospace;font-size:calc(11px*var(--tb-fs,1));font-weight:600;letter-spacing:.3px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tb-title{flex:1;min-width:0;font-size:calc(13.5px*var(--tb-fs,1));font-weight:600;line-height:1.5;word-break:break-word}',
      '.tb-pills{display:flex;flex-wrap:wrap;gap:6px}',
      '.tb-meta{display:grid;grid-template-columns:1fr 1fr;gap:7px 14px}',
      '.tb-meta-item{display:flex;flex-direction:column;gap:1px;min-width:0}',
      '.tb-meta-label{font-size:calc(10.5px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-meta-value{font-size:calc(12px*var(--tb-fs,1));word-break:break-word}',
      '.tb-sec{display:flex;flex-direction:column;gap:6px}',
      '.tb-sec-label{font-size:calc(10.5px*var(--tb-fs,1));font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));letter-spacing:.5px}',
      '.tb-desc{white-space:pre-wrap;word-break:break-word;font-size:calc(12px*var(--tb-fs,1));line-height:1.7;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;padding:9px 11px;max-height:220px;overflow:auto}',
      '.tb-code{white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:calc(11px*var(--tb-fs,1));line-height:1.5;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;padding:9px 11px;max-height:420px;overflow:auto;margin:0;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-line{display:flex;gap:8px;align-items:baseline;padding:1px 0;font-size:calc(12px*var(--tb-fs,1))}',
      '.tb-line-status{width:14px;text-align:center;font-weight:600;flex:none;font-family:ui-monospace,Consolas,monospace}',
      '.tb-line-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace}',
      '.tb-files{display:flex;flex-direction:column}',
      '.tb-file{display:flex;align-items:center;gap:9px;padding:6px 7px;margin:0 -7px;border-radius:6px;cursor:pointer;transition:background .12s}',
      '.tb-file:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))}',
      '.tb-ext{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:18px;padding:0 5px;border-radius:4px;font-size:calc(9.5px*var(--tb-fs,1));font-weight:700;letter-spacing:.3px;text-transform:uppercase;font-family:ui-monospace,Consolas,monospace;border:1px solid}',
      '.tb-ext-img{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-active-border,rgba(91,141,239,.4));background:var(--tb-accent-bg,rgba(91,141,239,.1))}',
      '.tb-ext-doc{color:var(--tb-done-text,#81c784);border-color:var(--tb-done-border,rgba(102,187,106,.35));background:var(--tb-ok-bg,rgba(102,187,106,.08))}',
      '.tb-ext-zip{color:var(--tb-warn-text,#d4b95c);border-color:var(--tb-warn-border,rgba(212,167,44,.35));background:rgba(212,167,44,.08)}',
      '.tb-ext-gen{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));border-color:var(--tb-muted-border,rgba(138,139,150,.3))}',
      '.tb-file-name{flex:1;min-width:0;font-size:calc(12px*var(--tb-fs,1));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tb-file:hover .tb-file-name{color:var(--tb-accent-text,#7fa7f0)}',
      '.tb-file-meta{flex:none;font-size:calc(11px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-file-act{flex:none;font-size:calc(11px*var(--tb-fs,1));color:var(--tb-accent,#3f6fd9);opacity:0;transition:opacity .12s}',
      '.tb-file:hover .tb-file-act{opacity:1}',
      '.tb-preview{display:flex;flex-direction:column;gap:8px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;padding:10px}',
      '.tb-preview-head{display:flex;align-items:center;gap:8px}',
      '.tb-preview-name{flex:1;min-width:0;font-size:calc(12px*var(--tb-fs,1));font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tb-preview-img{display:block;max-width:100%;max-height:320px;border-radius:6px;margin:0 auto}',
      '.tb-list-head{display:flex;align-items:center;gap:4px}',
      '.tb-list-title{flex:1;display:flex;align-items:center;gap:6px;font-size:calc(11px*var(--tb-fs,1));font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));letter-spacing:.4px}',
      '.tb-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:15px;padding:0 4px;border-radius:999px;background:var(--tb-accent-bg,rgba(91,141,239,.14));color:var(--tb-accent-text,#7fa7f0);font-size:calc(10px*var(--tb-fs,1));font-weight:700;font-variant-numeric:tabular-nums}',
      '.tb-list{display:flex;flex-direction:column;gap:4px}',
      '.tb-rec{display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;cursor:pointer;transition:background .12s,border-color .12s}',
      '.tb-rec:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))}',
      '.tb-rec-active{border-color:var(--tb-accent-border,rgba(91,141,239,.5))}',
      '.tb-rec-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.tb-rec-top{display:flex;align-items:center;gap:8px;min-width:0}',
      '.tb-rec-key{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:calc(11px*var(--tb-fs,1));font-weight:700;color:var(--tb-accent-text,#7fa7f0);letter-spacing:.3px}',
      '.tb-rec-summary{flex:1;min-width:0;font-size:calc(12px*var(--tb-fs,1));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tb-rec-sub{display:flex;align-items:center;gap:8px;font-size:calc(11px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-variant-numeric:tabular-nums;flex-wrap:wrap}',
      '.tb-rec-status{display:inline-flex;align-items:center;gap:5px}',
      '.tb-rec-acts{flex:none;display:flex;gap:2px;opacity:0;transition:opacity .12s}',
      '.tb-rec:hover .tb-rec-acts,.tb-rec-active .tb-rec-acts{opacity:1}',
      '.tb-tree{display:flex;flex-direction:column;gap:1px;font-size:calc(12.5px*var(--tb-fs,1))}',
      '.tb-tree-row{display:flex;align-items:center;gap:6px;height:24px;padding:0 8px 0 2px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:background .1s;user-select:none}',
      '.tb-tree-row:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#2b2c33))}',
      '.tb-tree-dir{color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-tree-dir .tb-tree-name{font-weight:600}',
      '.tb-tree-open>.tb-tree-chevron svg{transform:rotate(90deg)}',
      '.tb-tree-open>.tb-tree-ic{color:var(--tb-accent-text,#7fa7f0)}',
      '.tb-tree-file{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));cursor:default}',
      '.tb-tree-chevron{width:12px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-tree-chevron svg{transition:transform .12s}',
      '.tb-tree-ic{width:15px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-tree-dir>.tb-tree-ic{color:var(--tb-accent-text,#7fa7f0);opacity:.85}',
      '.tb-tree-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.tb-tree-size{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:calc(11px*var(--tb-fs,1));min-width:56px;text-align:right;flex:none;font-variant-numeric:tabular-nums}',
      '.tb-empty{display:flex;flex-direction:column;align-items:center;gap:5px;padding:26px 14px;border:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:8px;text-align:center}',
      '.tb-empty-glyph{width:30px;height:30px;border-radius:8px;border:1px solid var(--tb-accent-border,rgba(91,141,239,.3));display:flex;align-items:center;justify-content:center;margin-bottom:3px}',
      '.tb-empty-glyph svg{stroke:var(--tb-accent,#3f6fd9)}',
      '.tb-empty-title{font-size:calc(12px*var(--tb-fs,1));font-weight:600;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))}',
      '.tb-empty-sub{font-size:calc(11px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.tb-manage-list{display:flex;flex-direction:column;gap:6px}',
      '.tb-manage-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px}',
      '.tb-manage-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.tb-manage-label{font-size:calc(12.5px*var(--tb-fs,1));font-weight:600;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.tb-manage-id{font-size:calc(10.5px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-family:ui-monospace,Consolas,monospace}',
      '.tb-switch{position:relative;width:34px;height:19px;flex:none;border-radius:999px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));cursor:pointer;padding:0;appearance:none;outline:none;transition:background .15s,border-color .15s}',
      '.tb-switch::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));transition:transform .15s,background .15s}',
      '.tb-switch-on{background:var(--tb-accent,#3f6fd9);border-color:var(--tb-accent,#3f6fd9)}',
      '.tb-switch-on::after{transform:translateX(15px);background:#fff}',
      '.fl-row{display:flex;min-width:0}',
      '.fl-node{position:relative;max-width:520px;min-width:0;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-left-width:2px;border-radius:8px;padding:7px 10px;display:flex;flex-direction:column;gap:3px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));box-shadow:0 2px 8px rgba(0,0,0,.18)}',
      '.fl-node[data-action]{cursor:pointer;transition:border-color .12s}',
      '.fl-node[data-action]:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.fl-branch-btn{position:absolute;right:6px;top:5px;width:23px;height:21px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));cursor:pointer;padding:0;opacity:0;pointer-events:none;transform:translateY(2px);transition:opacity .12s,transform .12s,color .12s,border-color .12s}',
      '.fl-node:hover .fl-branch-btn,.fl-node:focus-within .fl-branch-btn{opacity:1;pointer-events:auto;transform:none}',
      '.fl-branch-btn:hover{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-accent-border,rgba(91,141,239,.45));background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b))}',
      '.fl-node[data-flow-role="ai"]{padding-right:36px}',
      '.fl-info{position:relative;flex:none;margin-left:auto;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));cursor:help;outline:none}',
      '.fl-info:hover,.fl-info:focus{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-active-text,#7fa7f0)}',
      '.fl-info-pop{position:absolute;right:0;top:30px;z-index:20;width:min(660px,84vw);display:none;padding:10px 12px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:8px;background:var(--dsw-alias-bg-overlay,#1e1f24);box-shadow:0 8px 24px rgba(0,0,0,.35);color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font-size:calc(11.5px*var(--tb-fs,1));font-weight:400;line-height:1.65;white-space:pre-line}',
      '.fl-info:hover .fl-info-pop,.fl-info:focus .fl-info-pop{display:block;animation:jrDrawerUp .12s ease-out}',
      '[data-flow-select-seq].fl-select-picked{outline:2px solid var(--tb-accent,#3f6fd9);outline-offset:2px;box-shadow:0 0 0 4px var(--tb-accent-ring,rgba(91,141,239,.16))}',
      '[data-flow-select-mode="1"] .tb-pane-body{cursor:crosshair;user-select:none}',
      '.fl-marquee{position:absolute;z-index:30;border:1px solid var(--tb-accent,#3f6fd9);background:var(--tb-accent-ring,rgba(91,141,239,.16));pointer-events:none;border-radius:3px}',
      '.fl-node.fl-on{border-color:var(--tb-accent-border,rgba(91,141,239,.6));background:linear-gradient(var(--tb-accent-bg,rgba(91,141,239,.08)),var(--tb-accent-bg,rgba(91,141,239,.08))),var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e))}',
      '.fl-model{flex:none;font-size:calc(10px*var(--tb-fs,1));font-family:ui-monospace,Consolas,monospace;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));background:var(--dsw-alias-bg-base,#17181d);border-radius:3px;padding:1px 5px}',
      '.fl-glyph{flex:none;font-size:calc(9px*var(--tb-fs,1));line-height:1;opacity:.9}',
      '.fl-node-head{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.fl-tag{flex:none;display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:4px;font-size:calc(10px*var(--tb-fs,1));font-weight:700;letter-spacing:.3px}',
      '.fl-retry{flex:none;display:inline-flex;align-items:center;height:15px;padding:0 5px;border-radius:4px;font-size:calc(9.5px*var(--tb-fs,1));font-weight:600;letter-spacing:.2px}',
      '.fl-retry-ok{color:var(--tb-done-text,#81c784);background:rgba(102,187,106,.12)}',
      '.fl-retry-wait{color:#d4b95c;background:rgba(212,167,44,.12)}',
      '.fl-retry-fail{color:var(--tb-danger-text,#f28b82);background:rgba(242,139,130,.12)}',
      '.fl-retry-cancel{color:var(--tb-text-3,#777884);background:rgba(138,139,150,.10)}',
      '.fl-time{flex:none;font-size:calc(10.5px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.fl-preview{font-size:calc(12px*var(--tb-fs,1));line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));max-width:500px}',
      '.fl-arrow{flex:none;align-self:center;line-height:1;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:calc(10px*var(--tb-fs,1));background:var(--dsw-alias-bg-base,#17181d);padding:0 3px;border-radius:3px}',
      '.fl-conn{flex:1;min-height:16px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-width:0}',
      '.fl-conn-gap{flex:1;min-height:4px}',
      '.jr-drawer [data-flow] .tb-pane-body{background:var(--dsw-alias-bg-base,#17181d);border-radius:8px;background-image:linear-gradient(rgba(128,138,150,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(128,138,150,.055) 1px,transparent 1px);background-size:22px 22px}',
      '.jr-drawer [data-flow] .tb-pane-body>*{zoom:var(--tb-flow-zoom,1)}',
      '.fl-par{flex:1;display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.fl-name{flex:1;min-width:0;font-family:ui-monospace,Consolas,monospace;font-size:calc(11.5px*var(--tb-fs,1));font-weight:700;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-args{font-family:ui-monospace,Consolas,monospace;font-size:calc(10.5px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-lane{display:grid;grid-template-columns:minmax(140px,1.05fr) minmax(180px,1fr) minmax(220px,1.2fr);gap:0 10px;min-width:0;align-items:stretch}',
      '.fl-lane-main{min-width:0;display:flex;flex-direction:column;justify-content:center;position:relative}',
      '.fl-lane-main::before{content:"";position:absolute;left:calc(50% - 1.25px);top:0;bottom:-4px;width:2.5px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.7;z-index:0}',
      '.fl-lane-main>*{position:relative;z-index:1}',
      '.fl-lane-main .fl-node{max-width:none}',
      '.fl-lane-side{min-width:0;display:grid;grid-template-columns:84px minmax(0,1fr);gap:6px 8px;align-items:center}',
      '.fl-lane-side.fl-grp{position:relative;border:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:10px;padding:10px 10px;margin:4px 0}',
      '.fl-grp-tag{position:absolute;top:-7px;right:10px;padding:0 5px;font-size:calc(9px*var(--tb-fs,1));line-height:13px;font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));background:var(--dsw-alias-bg-base,#17181d);border-radius:3px;letter-spacing:.3px}',
      '.fl-lane-line{width:2.5px;align-self:center;flex:1;min-height:26px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.7}',
      '.fl-subcol{position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));gap:8px;min-width:0;min-height:112px;align-items:stretch}',
      '.fl-subcol.fl-subgrp{border:1px dashed var(--tb-accent-border,rgba(91,141,239,.4));border-radius:10px;padding:11px 8px 8px}',
      '.fl-subgrp-tag{position:absolute;top:-7px;right:10px;padding:0 5px;font-size:calc(9px*var(--tb-fs,1));line-height:13px;font-weight:600;color:var(--tb-active-text,#7fa7f0);background:var(--dsw-alias-bg-base,#17181d);border-radius:3px;letter-spacing:.2px}',
      '.fl-subbranch{display:flex;flex-direction:column;gap:5px;min-width:0;min-height:104px}',
      '.fl-lane:has(> .fl-subcol){min-height:112px}',
      '.fl-sub-card{position:relative;flex:none;border:1px solid var(--tb-accent-border,rgba(91,141,239,.45));border-radius:8px;padding:5px 8px;background:var(--tb-accent-bg,rgba(91,141,239,.08));display:flex;flex-direction:column;gap:3px;min-width:0;cursor:pointer}',
      '.fl-sub-card::after{content:"";position:absolute;right:-11px;top:50%;width:10px;height:1px;background:var(--tb-accent-border,rgba(91,141,239,.45))}',
      '.fl-sub-steps{flex:1;min-height:22px;max-height:132px;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:3px 4px 3px 8px;margin-left:6px;border-left:1px dashed var(--tb-accent-border,rgba(91,141,239,.4))}',
      '.fl-sub-close{margin-top:auto}',
      '.fl-sub-meta{display:flex;align-items:center;gap:6px}',
      '.fl-sub-step{display:flex;align-items:center;gap:4px;min-width:0;font-size:calc(10.5px*var(--tb-fs,1))}',
      '.fl-sub-io{display:flex;align-items:baseline;gap:5px;font-family:ui-monospace,Consolas,monospace;font-size:calc(10.5px*var(--tb-fs,1));min-width:0}',
      '.fl-older{min-height:30px}',
      '.fl-wp{display:flex;flex-direction:column;justify-content:center;gap:10px;min-width:0}',
      '.fl-wl{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.fl-wl-txt{font-family:ui-monospace,Consolas,monospace;font-size:calc(9px*var(--tb-fs,1));line-height:1.2;color:var(--tb-accent-text,#7fa7f0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-wl-row{position:relative;display:flex;align-items:center;gap:3px;height:8px}',
      '.fl-wl-line{flex:1;height:1px;min-width:8px;background:var(--tb-accent-border,rgba(91,141,239,.45))}',
      '.fl-wl-arr{flex:none;font-size:calc(7px*var(--tb-fs,1));line-height:1;color:var(--tb-accent-border,rgba(91,141,239,.6))}',
      '.fl-wl-b .fl-wl-txt{color:var(--tb-done-text,#81c784)}',
      '.fl-wl-b .fl-wl-line{background:rgba(102,187,106,.45)}',
      '.fl-wl-b .fl-wl-arr{color:rgba(102,187,106,.6)}',
      '.fl-wl-err .fl-wl-txt{color:var(--tb-danger-text,#f28b82)}',
      '.fl-wl-err .fl-wl-line{background:rgba(239,83,80,.5)}',
      '.fl-wl-err .fl-wl-arr{color:rgba(239,83,80,.6)}',
      '.fl-wl-wait .fl-wl-txt{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-wl-wait .fl-wl-line{background:transparent;border-top:1px dashed var(--tb-border-2,var(--dsw-alias-border-l2,#454650))}',
      '.fl-callside{min-width:0;display:flex;flex-direction:column;gap:4px;justify-content:center}',
      '.fl-iocard{width:auto;max-width:none;min-width:0;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:9px;padding:6px 10px;display:flex;flex-direction:column;gap:3px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18);transition:border-color .12s,box-shadow .12s}',
      '.fl-iocard:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.fl-iocard.fl-on{border-color:var(--tb-accent-border,rgba(91,141,239,.6));background:var(--tb-accent-bg,rgba(91,141,239,.08))}',
      '.fl-iocard.fl-err{border-color:var(--tb-danger-border,rgba(239,83,80,.5))}',
      '.fl-live{border-color:var(--tb-accent-border,rgba(91,141,239,.65))!important;animation:flPulse 1.6s ease-in-out infinite}',
      '.fl-min-anim>.fl-wl:not(.fl-wl-b)>.fl-wl-row::after{content:"";position:absolute;top:50%;left:0;width:6px;height:3px;border-radius:999px;pointer-events:none;background:var(--tb-accent-text,#7fa7f0);box-shadow:0 0 3px var(--tb-accent-text,#7fa7f0),0 0 7px var(--tb-accent-text,#7fa7f0);animation:flWireTravelRight .5s linear var(--fl-min-delay,0ms) 1 both}',
      '.fl-output-anim>.fl-wl.fl-wl-b>.fl-wl-row::after{content:"";position:absolute;top:50%;right:0;width:6px;height:3px;border-radius:999px;pointer-events:none;background:var(--tb-done-text,#81c784);box-shadow:0 0 3px var(--tb-done-text,#81c784),0 0 7px var(--tb-done-text,#81c784);animation:flWireTravelLeft .5s linear var(--fl-output-delay,0ms) 1 both}',
      '.fl-min-anim .fl-iocard{position:relative;border-color:var(--tb-accent-border,rgba(91,141,239,.65))!important}',
      '.fl-min-anim .fl-live{animation:none}',
      '.fl-min-anim .fl-live .fl-iohead::before{animation:none;opacity:0}',
      '.fl-main-min-anim{position:relative;border-color:var(--tb-accent-border,rgba(91,141,239,.65))!important}',
      '.fl-live{position:relative}',
      '@supports (mask-composite: exclude) or (-webkit-mask-composite: xor){' +
        '.fl-live::before,.fl-min-anim .fl-iocard::before,.fl-main-min-anim::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.5px;' +
        'background:conic-gradient(from var(--fl-sweep,0deg),transparent 0deg,rgba(127,167,240,.9) 55deg,transparent 135deg);' +
        '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;' +
        'mask-composite:exclude;pointer-events:none}' +
        '.fl-live::before{animation:flSweep 1s linear infinite}' +
        '.fl-min-anim .fl-iocard::before{opacity:0;animation:flMinSweep 1s linear calc(500ms + var(--fl-min-delay,0ms)) 1 both}' +
        '.fl-main-min-anim::before{animation:flSweep 1s linear var(--fl-main-delay,0ms) 1 both}' +
        'body:not([data-ds-dark-theme]) .fl-live::before,body:not([data-ds-dark-theme]) .fl-min-anim .fl-iocard::before,body:not([data-ds-dark-theme]) .fl-main-min-anim::before{' +
        'background:conic-gradient(from var(--fl-sweep,0deg),transparent 0deg,rgba(43,102,240,.95) 80deg,transparent 165deg)}' +
      '}',
      '@property --fl-sweep{syntax:"<angle>";initial-value:0deg;inherits:false}',
      '@keyframes flSweep{to{--fl-sweep:360deg}}',
      '@keyframes flMinSweep{0%{opacity:0;--fl-sweep:0deg}.1%{opacity:1;--fl-sweep:0deg}99.9%{opacity:1;--fl-sweep:360deg}100%{opacity:0;--fl-sweep:360deg}}',
      '@keyframes flWireTravelRight{0%{opacity:0;left:0;transform:translateY(-50%) scale(.7)}10%{opacity:1}90%{opacity:1}100%{opacity:0;left:calc(100% - 6px);transform:translateY(-50%) scale(1)}}',
      '@keyframes flWireTravelLeft{0%{opacity:0;right:0;transform:translateY(-50%) scale(.7)}10%{opacity:1}90%{opacity:1}100%{opacity:0;right:calc(100% - 6px);transform:translateY(-50%) scale(1)}}',
      '.fl-live .fl-iohead::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--tb-done-text,#81c784);animation:flBlink 1.1s ease-in-out infinite}',
      '.fl-live .fl-node-head::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--tb-done-text,#81c784);animation:flBlink 1.1s ease-in-out infinite}',
      '@keyframes flBlink{0%,100%{opacity:1}50%{opacity:.25}}',
      '@keyframes flPulse{0%,100%{box-shadow:0 0 0 1.5px var(--tb-accent-ring,rgba(91,141,239,.16))}50%{box-shadow:0 0 0 4px var(--tb-accent-ring,rgba(91,141,239,.16))}}',
      '.fl-iohead{display:flex;align-items:center;gap:6px;min-width:0}',
      '.fl-status{flex:none;white-space:nowrap;font-size:calc(10.5px*var(--tb-fs,1));font-variant-numeric:tabular-nums}',
      '.fl-io-tag{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:3px;font-size:calc(9px*var(--tb-fs,1));font-weight:700}',
      '.fl-detail{display:flex;flex-direction:column;gap:6px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;padding:8px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));max-width:460px;margin-top:2px}',
      '.fl-sec{display:flex;flex-direction:column;gap:3px}',
      '.fl-rail-body>.fl-sec:last-child{flex:1;min-height:0}',
      '.fl-rail-body>.fl-sec:last-child>.fl-pre,.fl-rail-body>.fl-sec:last-child>.fl-markdown-rendered{flex:1;min-height:0;max-height:none}',
      '.fl-sec-label{font-size:calc(11px*var(--tb-fs-detail,1));font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));letter-spacing:.4px}',
      '.fl-pre{white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:calc(12px*var(--tb-fs-detail,1));line-height:1.5;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;padding:6px 8px;max-height:220px;overflow:auto;margin:0;background:var(--dsw-alias-bg-base,#17181d);color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-spin{flex:none;display:inline-block;width:10px;height:10px;border:1.5px solid var(--tb-accent-border,rgba(91,141,239,.35));border-top-color:var(--tb-accent,#3f6fd9);border-radius:50%;animation:tbSpin .7s linear infinite}',
      '.fl-rail{position:absolute;right:0;top:0;bottom:0;width:min(var(--fl-rail-w,350px),85%);display:flex;flex-direction:column;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));border-left:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));box-shadow:-8px 0 18px rgba(0,0,0,.24);z-index:4;border-radius:0 8px 8px 0}',
      '.fl-rail-anim{animation:jrDrawerIn .16s ease-out}',
      '.fl-rail-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));font-size:calc(12px*var(--tb-fs-detail,1));font-weight:600;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-rail-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace}',
      '.fl-rail-x{flex:none;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));cursor:pointer;border-radius:5px;padding:0;font-size:calc(12px*var(--tb-fs-detail,1));font-family:inherit}',
      '.fl-rail-x:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-rail-body{flex:1;min-height:0;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px}',
      '.fl-rail-body[data-flow-markdown-enhanced="1"] [data-flow-markdown-source]{display:none}',
      '.fl-markdown-rendered{min-width:0;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;padding:6px 8px;max-height:min(70vh,520px);overflow:auto;background:var(--dsw-alias-bg-base,#17181d);color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:calc(13px*var(--tb-fs-detail,1));line-height:1.6}',
      '.fl-markdown-rendered>*{min-width:0}',
      '.fl-rail-resize{position:absolute;left:-4px;top:0;bottom:0;width:9px;cursor:col-resize;z-index:6;touch-action:none}',
      '.fl-rail-resize::after{content:"";position:absolute;left:3px;top:0;bottom:0;width:2px;border-radius:1px;background:transparent;transition:background .12s}',
      '.fl-rail-resize:hover::after,.fl-rail-dragging .fl-rail-resize::after{background:var(--tb-accent-border,rgba(91,141,239,.5))}',
      '.fl-rail-dragging{user-select:none}',
      '.fl-rail-head .fl-branch-btn{position:static;opacity:1;pointer-events:auto;transform:none;width:22px;height:20px;flex:none}',
      '.fl-rule-list{display:flex;flex-direction:column;gap:8px}',
      '.fl-rule-card{display:flex;flex-direction:column;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;background:var(--dsw-alias-bg-base,#17181d);overflow:hidden;transition:border-color .12s,opacity .12s}',
      '.fl-rule-card.fl-rule-open{border-color:var(--tb-accent-border,rgba(91,141,239,.55))}',
      '.fl-rule-card.fl-rule-off{opacity:.62}',
      '.fl-rule-summary{display:flex;align-items:center;min-width:0;padding:5px 6px 5px 8px;gap:3px}',
      '.fl-rule-main{flex:1;min-width:0;display:flex;align-items:center;gap:7px;padding:2px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font-family:inherit}',
      '.fl-rule-main:hover .fl-rule-copy>strong{color:var(--tb-active-text,#7fa7f0)}',
      '.fl-rule-dot{flex:none;width:8px;height:8px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.06)}',
      '.fl-rule-badge{flex:none;max-width:70px;padding:1px 5px;border-radius:4px;font-size:calc(9px*var(--tb-fs-detail,1));font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fl-rule-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.fl-rule-copy>strong{font-size:calc(11.5px*var(--tb-fs-detail,1));font-weight:600;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .12s}',
      '.fl-rule-copy>small{font-size:calc(9.5px*var(--tb-fs-detail,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fl-rule-chevron{flex:none;width:15px;height:15px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));transition:transform .12s}',
      '.fl-rule-open .fl-rule-chevron{transform:rotate(90deg)}',
      '.fl-rule-chevron svg,.fl-rule-icon svg,.fl-rule-add svg{display:block;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}',
      '.fl-rule-switch{position:relative;flex:none;width:31px;height:18px;padding:0;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:999px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));cursor:pointer;transition:background .15s,border-color .15s}',
      '.fl-rule-switch>span{position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s,background .15s}',
      '.fl-rule-switch.is-on{background:var(--tb-accent,#3f6fd9);border-color:var(--tb-accent,#3f6fd9)}',
      '.fl-rule-switch.is-on>span{transform:translateX(13px);background:#fff}',
      '.fl-rule-switch:focus-visible{outline:2px solid var(--tb-accent-border,rgba(91,141,239,.65));outline-offset:2px}',
      '.fl-rule-icon{flex:none;width:25px;height:25px;padding:5px;border:0;border-radius:6px;background:transparent;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));cursor:pointer;transition:color .12s,background .12s}',
      '.fl-rule-icon:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-rule-delete:hover{color:var(--tb-danger-text,#f28b82);background:rgba(239,83,80,.1)}',
      '.fl-rule-editor{display:none;flex-direction:column;gap:8px;padding:4px 9px 9px;border-top:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e))}',
      '.fl-rule-open>.fl-rule-editor{display:flex}',
      '.fl-rule-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:7px 8px}',
      '.fl-rule-grid>label{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.fl-rule-grid>label>span{font-size:calc(10px*var(--tb-fs-detail,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-rule-grid .tb-input{width:100%;height:27px;padding:0 7px;font-size:calc(11px*var(--tb-fs-detail,1))}',
      '.fl-rule-color{width:100%;height:27px;padding:2px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));cursor:pointer}',
      '.fl-rule-editor-actions{display:flex;justify-content:flex-end;gap:6px}',
      '.fl-rule-new{display:none;padding:9px;border-style:dashed;overflow:visible}',
      '.fl-rule-new.fl-rule-open{display:flex}',
      '.fl-rule-new .fl-rule-editor{padding:0;border-top:0}',
      '.fl-rule-new-title{font-size:calc(12px*var(--tb-fs-detail,1));font-weight:600;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-rule-add{flex:none;display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 7px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:6px;background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font:inherit;font-size:calc(10px*var(--tb-fs-detail,1));cursor:pointer}',
      '.fl-rule-add:hover{border-color:var(--tb-accent-border,rgba(91,141,239,.55));color:var(--tb-active-text,#7fa7f0)}',
      '.fl-rule-add svg{width:13px;height:13px}',
      '.fl-rule-source{display:flex;flex-direction:column;gap:7px;border-top:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));padding-top:8px}',
      '.fl-rule-source>summary{cursor:pointer;user-select:none}',
      '.fl-rule-source[open]>summary{margin-bottom:7px}',
      '.fl-rule-source .tb-textarea{min-height:210px;resize:vertical;margin-bottom:7px}',
      '@media(max-width:620px){.fl-rule-grid{grid-template-columns:minmax(0,1fr)}}',
      '.fg-settings{display:flex;flex-direction:column;gap:16px;margin:20px 0 26px;color:var(--dsw-alias-label-primary,#dcdee4);font-family:inherit}',
      '.fg-settings-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}',
      '.fg-settings-title{margin:0;font-size:16px;line-height:1.4;font-weight:650}',
      '.fg-settings-sub{margin:4px 0 0;color:var(--dsw-alias-label-secondary,#9a9ba6);font-size:12px;line-height:1.6}',
      '.fg-settings-section{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l1,#35363e);border-radius:10px;background:var(--dsw-alias-bg-base,#17181d)}',
      '.fg-settings-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.fg-settings-section h3{margin:0;font-size:14px;font-weight:650}',
      '.fg-settings-note{margin:0;color:var(--dsw-alias-label-secondary,#9a9ba6);font-size:11.5px;line-height:1.6}',
      '.fg-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px}',
      '.fg-settings-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:42px}',
      '.fg-settings-copy{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.fg-settings-copy>strong{font-size:12.5px;font-weight:600}',
      '.fg-settings-copy>small{color:var(--dsw-alias-label-tertiary,#777884);font-size:10.5px;line-height:1.45}',
      '.fg-settings-select,.fg-settings-input{width:min(210px,45%);height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2,#454650);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#26272e);color:inherit;font:inherit;font-size:12px;box-sizing:border-box}',
      '.fg-settings-input.is-official{height:auto;padding:0;border:0;background:transparent}',
      '.fg-settings-toggle{position:relative;flex:none;width:36px;height:21px;padding:0;border:1px solid var(--dsw-alias-border-l2,#454650);border-radius:999px;background:var(--dsw-alias-bg-layer-1,#26272e);cursor:pointer}',
      '.fg-settings-toggle>span{position:absolute;left:2px;top:2px;width:15px;height:15px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#777884);transition:transform .15s,background .15s}',
      '.fg-settings-toggle.is-on{border-color:var(--tb-accent,#3f6fd9);background:var(--tb-accent,#3f6fd9)}',
      '.fg-settings-toggle.is-on>span{transform:translateX(15px);background:#fff}',
      '.fg-settings-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}',
      '.fg-settings-button{height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#454650);border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}',
      '.fg-settings-button:hover{border-color:var(--tb-accent-border,rgba(91,141,239,.55));color:var(--tb-active-text,#7fa7f0)}',
      '.fg-settings-button.primary{border-color:var(--tb-accent,#3f6fd9);background:var(--tb-accent,#3f6fd9);color:#fff}',
      '.fg-settings-button.danger:hover{border-color:#ef5350;color:#f28b82}',
      '.fg-settings-button:disabled{opacity:.45;cursor:not-allowed}',
      '.fg-settings-status{margin-right:auto;font-size:11.5px;color:var(--tb-done-text,#81c784)}',
      '.fg-settings-status.is-error{color:var(--tb-danger-text,#f28b82)}',
      '.fg-settings-rules{display:flex;flex-direction:column;gap:10px}',
      '.fg-settings-rule{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1,#35363e);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#222329)}',
      '.fg-settings-rule.is-off{opacity:.62}',
      '.fg-settings-rule-head{display:flex;align-items:center;gap:9px}',
      '.fg-settings-rule-head>strong{flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fg-settings-rule-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}',
      '.fg-settings-rule-grid label{display:flex;flex-direction:column;gap:4px;min-width:0;color:var(--dsw-alias-label-tertiary,#777884);font-size:10.5px}',
      '.fg-settings-rule-grid .fg-settings-input{width:100%;max-width:none}',
      '.fg-settings-color{width:100%;height:30px;padding:2px;border:1px solid var(--dsw-alias-border-l2,#454650);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#26272e);cursor:pointer}',
      '@media(max-width:760px){.fg-settings-grid{grid-template-columns:minmax(0,1fr)}.fg-settings-rule-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}',
      '.fl-skill-hero{display:flex;align-items:center;gap:7px;padding:8px;border:1px solid var(--tb-accent-border,rgba(91,141,239,.38));border-radius:7px;background:var(--tb-accent-bg,rgba(91,141,239,.08))}',
      '.fl-skill-hero>.fl-tag{color:var(--tb-active-text,#7fa7f0);background:rgba(91,141,239,.13)}',
      '.fl-skill-hero>strong{flex:1;min-width:0;font-family:ui-monospace,Consolas,monospace;font-size:calc(13px*var(--tb-fs-detail,1));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fl-skill-field{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:8px;padding:7px 8px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:7px}',
      '.fl-skill-field>span{font-size:calc(10px*var(--tb-fs-detail,1));font-weight:600;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-skill-field>code{min-width:0;font-family:ui-monospace,Consolas,monospace;font-size:calc(10.5px*var(--tb-fs-detail,1));color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));word-break:break-all}',
      '.fl-skill-instructions{flex:1;min-height:0}',
      '.fl-skill-instructions>.fl-pre,.fl-skill-instructions>.fl-markdown-rendered{flex:1;min-height:180px;max-height:none}',
      '.fl-skill-raw{flex:none;border-top:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));padding-top:7px}',
      '.fl-skill-raw>summary{cursor:pointer;user-select:none;font-size:calc(10.5px*var(--tb-fs-detail,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-skill-raw[open]>summary{margin-bottom:7px}',
      '.fl-sec-head{display:flex;align-items:center;gap:6px;min-width:0}',
      '.fl-sec-head .fl-sec-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fl-copy-btn,.fl-md-preview-btn{flex:none;width:22px;height:20px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));background:transparent;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));line-height:1;cursor:pointer;font-family:inherit;transition:color .12s,border-color .12s,background .12s}',
      '.fl-copy-btn:hover,.fl-md-preview-btn:hover{color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));border-color:var(--tb-accent-border,rgba(91,141,239,.45))}',
      '.fl-md-preview-btn[aria-pressed="true"]{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-accent-border,rgba(91,141,239,.45));background:var(--tb-active-bg,rgba(91,141,239,.12))}',
      '.fl-copy-btn.fl-copied{color:var(--tb-done-text,#81c784);border-color:var(--tb-done-text,#81c784)}',
      '.fl-copy-btn.fl-copy-fail{color:var(--tb-danger-text,#f28b82);border-color:var(--tb-danger-text,#f28b82)}',
      '.fl-branch-pill{flex:none;font-size:calc(9.5px*var(--tb-fs-detail,1));padding:0 5px;border-radius:3px;background:rgba(91,141,239,.12);color:var(--tb-active-text,#7fa7f0);font-weight:600}',
      '.fl-branch-txt{flex:1;min-width:0;font-family:ui-monospace,Consolas,monospace;font-size:calc(11px*var(--tb-fs-detail,1));color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-branch-ai{font-style:italic}',
      '.fl-zoom-tree{display:flex;flex-direction:column;align-items:center;align-self:stretch;padding:4px 2px 10px;min-width:0}',
      '@keyframes flZoomFocusIn{from{opacity:.82;transform:scale(.975)}to{opacity:1;transform:scale(1)}}',
      '@keyframes flZoomOverviewIn{from{opacity:.82;transform:scale(1.025)}to{opacity:1;transform:scale(1)}}',
      '.fl-zoom-motion-focus>.tb-pane-body{transform-origin:center top;animation:flZoomFocusIn .16s ease-out}',
      '.fl-zoom-motion-overview>.tb-pane-body{transform-origin:center top;animation:flZoomOverviewIn .16s ease-out}',
      '.fl-zoom-near-flow{align-self:stretch;width:100%;min-width:0;display:flex;flex-direction:column;gap:0}',
      '.fl-zoom-rootcard{position:relative;width:min(340px,92%);display:flex;flex-direction:column;gap:5px;border:1px solid var(--tb-accent-border,rgba(91,141,239,.45));border-radius:10px;padding:8px 12px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));box-shadow:0 2px 8px rgba(0,0,0,.18);cursor:pointer;transition:border-color .12s}',
      '.fl-zoom-rootcard:hover{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.fl-zoom-rootcard-virtual{border-style:dashed;cursor:default;align-items:center;padding:7px 12px}',
      '.fl-zoom-trunk{flex:none;width:1.5px;height:16px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.55}',
      '.fl-zoom-branches{position:relative;display:flex;gap:14px;align-items:flex-start;justify-content:safe center;align-self:stretch;overflow-x:auto;padding:16px 6px 4px}',
      '.fl-zoom-branch{position:relative;flex:none;width:min(236px,84%);display:flex;flex-direction:column;gap:8px;cursor:pointer;min-width:0}',
      '.fl-zoom-branch::before{content:"";position:absolute;top:-16px;left:50%;width:1.5px;height:16px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.55}',
      '.fl-zoom-branch::after{content:"";position:absolute;top:-16px;left:calc(-50% - 14px);right:50%;height:1.5px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.55}',
      '.fl-zoom-branch:first-child::after{display:none}',
      '.fl-zoom-card,.fl-zoom-branch-head{position:relative;display:flex;flex-direction:column;gap:5px;min-width:0;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:10px;padding:8px 11px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));box-shadow:0 2px 8px rgba(0,0,0,.18);transition:border-color .12s}',
      '.fl-zoom-branch:hover .fl-zoom-branch-head{border-color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#6f707c))}',
      '.fl-zoom-head{display:flex;align-items:center;gap:7px;min-width:0}',
      '.fl-zoom-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--tb-text-3,#777884);opacity:.5}',
      '.fl-zoom-dot-online{background:var(--tb-active-text,#7fa7f0);opacity:.9}',
      '.fl-zoom-dot-running{background:var(--tb-done-text,#81c784);opacity:1;animation:flBlink 1.1s ease-in-out infinite}',
      '.fl-zoom-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:calc(12px*var(--tb-fs,1));font-weight:600;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-zoom-id{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:calc(10px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-zoom-badges{display:flex;flex-wrap:wrap;gap:4px}',
      '.fl-zoom-badge{display:inline-flex;align-items:center;height:16px;padding:0 5px;border-radius:4px;font-size:calc(9.5px*var(--tb-fs,1));font-weight:600;background:rgba(138,139,150,.12);color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))}',
      '.fl-zoom-badge-home{background:rgba(91,141,239,.12);color:var(--tb-active-text,#7fa7f0)}',
      '.fl-zoom-badge-cwd{background:rgba(212,167,44,.10);color:#d4b95c}',
      '.fl-zoom-stats{font-size:calc(10.5px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fl-zoom-flow{position:relative;display:flex;flex-direction:column;gap:5px;padding:2px 0 2px 16px}',
      '.fl-zoom-flow::before{content:"";position:absolute;left:6px;top:0;bottom:4px;width:1.5px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.4}',
      '.fl-zoom-step{position:relative;display:flex;align-items:center;gap:6px;min-width:0;min-height:18px}',
      '.fl-zoom-step::before{content:"";position:absolute;left:-10px;top:50%;width:8px;height:1.5px;background:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));opacity:.4}',
      '.fl-zoom-step-txt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:calc(10.5px*var(--tb-fs,1));color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))}',
      '.fl-zoom-step-ok{flex:none;font-size:calc(10px*var(--tb-fs,1));color:var(--tb-done-text,#81c784)}',
      '.fl-zoom-step-err{flex:none;font-size:calc(10px*var(--tb-fs,1));color:var(--tb-danger-text,#f28b82)}',
      '.fl-zoom-glyph{font-size:calc(10px*var(--tb-fs,1));line-height:1}',
      '.fl-zoom-tool{max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 5px;border-radius:3px;font-size:calc(9.5px*var(--tb-fs,1));font-weight:600;line-height:1.5;flex:none}',
      '.fl-zoom-tool-err{color:var(--tb-danger-text,#f28b82)!important;background:rgba(242,139,130,.12)!important}',
      '.fl-zoom-tool-pending{animation:flBlink 1.1s ease-in-out infinite}',
      '.fl-zoom-more{font-size:calc(9.5px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-zoom-composer{display:flex;flex-direction:column;gap:7px;padding:9px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:12px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));box-shadow:0 2px 10px rgba(0,0,0,.14)}',
      '.fl-zoom-composer-context{display:flex;align-items:center;gap:8px;min-width:0;padding-bottom:7px;border-bottom:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));font-size:calc(10px*var(--tb-fs,1))}',
      '.fl-zoom-composer-context>strong{flex:none;color:var(--tb-active-text,#7fa7f0)}',
      '.fl-zoom-composer-context>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-zoom-composer-targets{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:5px;min-width:0;margin-left:auto;overflow:visible}',
      '.fl-zoom-composer-targets.is-drop-target{outline:2px solid var(--tb-active-text,#7fa7f0);outline-offset:2px;border-radius:7px;background:rgba(91,141,239,.08)}',
      '.fl-zoom-composer-targets .fl-zoom-current-session{min-width:158px;max-width:220px}',
      '.fl-zoom-add-picker{height:27px;padding:0 8px;border:1px dashed var(--tb-accent-border,rgba(91,141,239,.45));border-radius:6px;background:transparent;color:var(--tb-active-text,#7fa7f0);font:inherit;font-size:calc(10px*var(--tb-fs,1));cursor:pointer;white-space:nowrap}',
      '.fl-zoom-add-picker:hover{background:rgba(91,141,239,.1)}',
      '.fl-zoom-add-menu{position:relative;flex:none}',
      '.fl-zoom-add-menu>summary{height:27px;display:inline-flex;align-items:center;padding:0 8px;border:1px dashed var(--tb-accent-border,rgba(91,141,239,.45));border-radius:6px;color:var(--tb-active-text,#7fa7f0);cursor:pointer;list-style:none;white-space:nowrap}',
      '.fl-zoom-add-menu>summary::-webkit-details-marker{display:none}',
      '.fl-zoom-add-pop{position:absolute;right:0;top:32px;z-index:30;width:280px;max-height:300px;display:flex;flex-direction:column;gap:4px;overflow:auto;padding:7px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:9px;background:var(--tb-bg,#17181c);box-shadow:0 10px 28px rgba(0,0,0,.48)}',
      '.fl-zoom-add-pop>button{min-height:31px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:4px 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font:inherit;font-size:calc(10px*var(--tb-fs,1));text-align:left;cursor:pointer}',
      '.fl-zoom-add-pop>button:hover{border-color:var(--tb-accent-border,rgba(91,141,239,.45));background:rgba(91,141,239,.09);color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-zoom-add-pop>button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fl-zoom-add-pop>button code{color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:inherit}',
      '.fl-zoom-add-pop>.fl-zoom-add-new{display:flex;justify-content:center;border-color:var(--tb-accent-border,rgba(91,141,239,.45));color:var(--tb-active-text,#7fa7f0);font-weight:700}',
      '.fl-zoom-add-pop>small,.fl-zoom-add-empty{padding:4px 6px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:calc(9px*var(--tb-fs,1))}',
      '.fl-zoom-prompt{width:100%;min-height:48px;max-height:120px;resize:vertical;border:none!important;background:transparent!important;padding:2px 3px!important;line-height:1.5}',
      '.fl-zoom-prompt:focus{box-shadow:none!important;outline:none!important}',
      '.fl-zoom-composer-controls{display:flex;align-items:center;gap:6px;min-width:0;overflow-x:auto}',
      '.fl-zoom-composer-spacer{flex:1;min-width:10px}',
      '.fl-zoom-target-label{flex:none;font-size:calc(10px*var(--tb-fs,1));font-weight:650;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));white-space:nowrap}',
      '.fl-zoom-count{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:7px}',
      '.fl-zoom-count .tb-chip{min-width:25px;justify-content:center;padding:0 6px}',
      '.fl-zoom-lane-group{flex:none;display:inline-flex;align-items:center;min-width:0}',
      '.fl-zoom-lane{flex:none;height:26px;font-size:calc(11px*var(--tb-fs,1))}',
      '.fl-zoom-lane-model{width:144px;border-radius:6px 0 0 6px}',
      '.fl-zoom-lane-effort{width:92px;margin-left:-1px;border-radius:0 6px 6px 0}',
      '.fl-zoom-logbar{padding-top:2px;border-top:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e))}',
      '.fl-zoom-log-spacer{flex:1}',
      '.fl-zoom-history-drawer{position:absolute;right:0;top:0;bottom:0;z-index:18;width:min(292px,76%);display:flex;flex-direction:column;border-left:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));background:var(--tb-bg,#17181c);color:var(--tb-text,#dcdee4);box-shadow:-8px 0 24px rgba(0,0,0,.42)}',
      '.fl-zoom-history-drawer-head{height:38px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;border-bottom:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));font-size:calc(11px*var(--tb-fs,1))}',
      '.fl-zoom-history-drawer-head button{width:24px;height:24px;border:none;border-radius:5px;background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));cursor:pointer}',
      '.tb-flow-bring-popup,.fl-rail,.fl-zoom-history-drawer,.tb-flow-zoom-float,.tb-flow-selection-bar,.fl-info-pop,.fl-zoom-add-pop,.tb-jump-latest,.jr-resize-badge{border-color:color-mix(in srgb,var(--tb-active-text,#7fa7f0) 34%,transparent);background:linear-gradient(145deg,color-mix(in srgb,var(--dsw-alias-bg-overlay,#1e1f24) 48%,rgba(122,162,240,.16)),color-mix(in srgb,var(--dsw-alias-bg-overlay,#1e1f24) 30%,transparent));box-shadow:0 20px 58px rgba(0,0,0,.42),0 6px 20px rgba(0,0,0,.26),inset 0 1px 0 rgba(255,255,255,.11);backdrop-filter:blur(26px) saturate(175%);-webkit-backdrop-filter:blur(26px) saturate(175%)}',
      '.tb-flow-bring-popup::before,.fl-info-pop::before,.fl-zoom-add-pop::before{content:"";position:absolute;left:9%;right:9%;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(151,184,248,.6),transparent);pointer-events:none}',
      '.fl-zoom-add-menu[open] .fl-zoom-add-pop{animation:jrDrawerUp .14s ease-out}',
      '.tb-flow-bring-popup .tb-flow-popup-head,.fl-rail-head,.fl-zoom-history-drawer-head{border-bottom-color:rgba(255,255,255,.08)}',
      '.tb-flow-bring-popup .tb-flow-tree-workspace,.tb-flow-bring-popup .tb-flow-tree-session{transition:background .14s ease,border-color .14s ease,transform .14s ease}',
      '.tb-flow-bring-popup .tb-flow-tree-workspace:hover,.tb-flow-bring-popup .tb-flow-tree-session:hover{background:color-mix(in srgb,var(--tb-active-text,#7fa7f0) 11%,transparent);transform:translateX(1px)}',
      '.fl-zoom-history-tree{flex:1;overflow:auto;padding:7px}',
      '.fl-history-node{margin-bottom:5px;border-radius:7px}',
      '.fl-history-node.is-active{background:rgba(91,141,239,.07)}',
      '.fl-history-run-line{display:grid;grid-template-columns:24px minmax(0,1fr);align-items:center}',
      '.fl-history-toggle{width:24px;height:26px;border:none;border-radius:5px;background:transparent;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font:inherit;cursor:pointer}',
      '.fl-history-toggle:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-history-run,.fl-history-round,.fl-history-session{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;border:none;border-radius:6px;background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font:inherit;cursor:pointer;text-align:left}',
      '.fl-history-run{min-height:30px;padding:4px 7px;font-size:calc(10.5px*var(--tb-fs,1));font-weight:650}',
      '.fl-history-round{min-height:27px;padding:3px 8px 3px 18px;font-size:calc(10px*var(--tb-fs,1));font-weight:600}',
      '.fl-history-round-node.is-active>.fl-history-round{background:rgba(91,141,239,.11);color:var(--tb-active-text,#7fa7f0)}',
      '.fl-history-session{min-height:24px;padding:3px 8px 3px 34px;font-size:calc(9.8px*var(--tb-fs,1))}',
      '.fl-history-run:hover,.fl-history-round:hover,.fl-history-session:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-history-session code{font-size:inherit;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-zoom-current-conversations{display:flex;align-items:center;gap:5px;overflow-x:auto;padding:5px 7px;border:1px solid var(--tb-accent-border,rgba(91,141,239,.45));border-radius:8px;background:rgba(91,141,239,.055)}',
      '.fl-zoom-current-conversations>strong{flex:none;font-size:calc(10.5px*var(--tb-fs,1));color:var(--tb-active-text,#7fa7f0)}',
      '.fl-zoom-current-item{position:relative;display:inline-flex;align-items:center;flex:none}',
      '.fl-zoom-current-item .fl-zoom-current-session{padding-right:26px}',
      '.fl-zoom-current-session{flex:none;display:grid;grid-template-columns:auto minmax(80px,1fr) auto;align-items:center;gap:6px;min-width:180px;max-width:270px;height:27px;padding:0 7px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:6px;background:transparent;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font:inherit;font-size:calc(10px*var(--tb-fs,1));cursor:pointer;text-align:left}',
      '.fl-zoom-current-session:hover,.fl-zoom-current-session.is-active{border-color:var(--tb-accent-border,rgba(91,141,239,.45));background:rgba(91,141,239,.08);color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-zoom-current-session span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fl-zoom-current-session code{font-size:inherit;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-zoom-current-remove{width:20px;height:20px;margin-left:-24px;z-index:1;border:none;border-radius:4px;background:transparent;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));cursor:pointer}',
      '.fl-zoom-current-remove:hover{background:rgba(242,139,130,.13);color:var(--tb-danger-text,#f28b82)}',
      '.fl-zoom-diff-scroll{align-self:stretch;overflow-x:auto;overflow-y:visible;padding:2px 2px 12px}',
      '.fl-zoom-diff-board{display:grid;align-items:stretch;width:max-content;min-width:max-content;margin-inline:auto;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:9px;overflow:clip;background:var(--tb-bg,var(--dsw-alias-bg-base,#17181c))}',
      '.fl-diff-corner,.fl-diff-session-head{position:sticky;top:0;z-index:4;min-height:58px;padding:7px 9px;border-bottom:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e))}',
      '.fl-diff-corner{left:0;z-index:5;display:flex;align-items:center;justify-content:center;font-size:calc(10px*var(--tb-fs,1));font-weight:700;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-diff-session-head{cursor:pointer;border-left:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e))}',
      '.fl-diff-session-head:hover{background:var(--tb-hover-bg,var(--dsw-alias-bg-layer-2,#31323b))}',
      '.fl-diff-session-label{display:inline-flex;margin-bottom:5px;padding:1px 6px;border-radius:999px;background:rgba(91,141,239,.13);color:var(--tb-active-text,#7fa7f0);font-size:calc(9.5px*var(--tb-fs,1));font-weight:750}',
      '.fl-diff-gutter{position:sticky;left:0;z-index:2;display:flex;flex-direction:column;gap:3px;padding:10px 7px;border-top:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));font-size:calc(10px*var(--tb-fs,1))}',
      '.fl-diff-gutter strong{font-size:calc(11px*var(--tb-fs,1));color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4))}',
      '.fl-diff-gutter small{display:flex;flex-direction:column;gap:2px;line-height:1.35;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-diff-dim{display:inline-flex;gap:4px;white-space:pre}',
      '.fl-diff-dim-same{color:var(--tb-done-text,#81c784)}',
      '.fl-diff-dim-change{color:#e6b94b;font-weight:700}',
      '.fl-diff-dim-missing{color:var(--tb-danger-text,#f28b82);font-weight:700}',
      '.fl-diff-round-fork{margin-top:5px;min-height:24px;padding:2px 5px;border:1px solid var(--tb-accent-border,rgba(91,141,239,.45));border-radius:5px;background:rgba(91,141,239,.08);color:var(--tb-active-text,#7fa7f0);font:inherit;font-size:calc(9.5px*var(--tb-fs,1));cursor:pointer}',
      '.fl-diff-same{box-shadow:inset 3px 0 var(--tb-done-text,#81c784)}',
      '.fl-diff-change{box-shadow:inset 3px 0 #d4b95c}',
      '.fl-diff-missing{box-shadow:inset 3px 0 var(--tb-danger-text,#f28b82)}',
      '.fl-diff-cell{position:relative;min-height:90px;padding:9px 10px 12px;border-top:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-left:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));background:rgba(128,128,128,.025)}',
      '.fl-diff-cell-same{background:rgba(129,199,132,.035)}',
      '.fl-diff-cell-base{background:rgba(91,141,239,.045)}',
      '.fl-diff-cell-change{background:rgba(212,167,44,.075)}',
      '.fl-diff-cell-missing{display:flex;align-items:center;justify-content:center;background:rgba(242,139,130,.055);color:var(--tb-danger-text,#f28b82)}',
      '.fl-diff-cell-head{display:flex;align-items:center;gap:6px;min-height:22px;margin-bottom:7px;font-size:calc(10px*var(--tb-fs,1));color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884))}',
      '.fl-diff-mark{width:14px;font-family:ui-monospace,Consolas,monospace;font-weight:800;text-align:center}',
      '.fl-diff-branch{margin-left:auto;min-height:23px;padding:2px 7px;border:1px solid var(--tb-accent-border,rgba(91,141,239,.45));border-radius:5px;background:rgba(91,141,239,.07);color:var(--tb-active-text,#7fa7f0);font:inherit;font-size:calc(9.5px*var(--tb-fs,1));font-weight:650;cursor:pointer;white-space:nowrap}',
      '.fl-diff-branch:hover{background:rgba(91,141,239,.12);border-color:var(--tb-accent-border,rgba(91,141,239,.45))}',
      '[data-flow-view="map"]>.tb-pane-body{flex-direction:column;justify-content:flex-start;gap:0;overflow:hidden;padding-right:0}',
      '[data-flow-view="map"]>.tb-pane-body>.fl-mindmap-wrap{zoom:1;flex:1;min-height:0;height:100%}',
      '.fl-mindmap-wrap{align-self:stretch;display:flex;flex-direction:column;gap:7px;min-width:0}',
      '.fl-mindmap-help{display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:8px;background:var(--tb-input-bg,var(--dsw-alias-bg-layer-1,#26272e));font-size:calc(10px*var(--tb-fs,1));color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))}',
      '.fl-mindmap-help strong{color:var(--tb-active-text,#7fa7f0)}',
      '.fl-mindmap-help span{flex:1}',
      '.fl-mindmap-help button{flex:none;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:5px;background:transparent;color:inherit;font:inherit;cursor:pointer}',
      '.fl-mindmap-viewport{position:relative;flex:1;min-height:0;overflow:auto;border:1px solid var(--tb-border,var(--dsw-alias-border-l1,#35363e));border-radius:10px;background-color:var(--tb-bg,var(--dsw-alias-bg-base,#17181c));background-image:radial-gradient(circle,rgba(127,128,140,.22) 1px,transparent 1px);background-size:20px 20px;cursor:grab;touch-action:none}',
      '.fl-mindmap-viewport.is-panning{cursor:grabbing}',
      '.fl-mindmap-canvas{position:relative;min-width:100%;min-height:100%}',
      '.fl-mindmap-edges{position:absolute;inset:0;pointer-events:none;overflow:visible}',
      '.fl-mindmap-edges path{fill:none;stroke:var(--tb-accent-border,rgba(91,141,239,.45));stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
      '.fl-map-turn-label{position:absolute;z-index:3;width:76px;display:flex;align-items:center;gap:5px;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:calc(9.5px*var(--tb-fs,1));pointer-events:none}',
      '.fl-map-turn-label span{display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border:1px solid var(--tb-accent-border,rgba(91,141,239,.45));border-radius:50%;background:var(--tb-bg,var(--dsw-alias-bg-base,#17181c));color:var(--tb-active-text,#7fa7f0);font-weight:800}',
      '.fl-map-turn-label strong{white-space:nowrap}',
      '.fl-map-node{position:absolute;z-index:2;min-height:126px;display:flex;flex-direction:column;gap:7px;padding:9px;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:10px;background:var(--tb-card-bg,var(--dsw-alias-bg-layer-1,#26272e));box-shadow:0 5px 16px rgba(0,0,0,.22);cursor:move;user-select:none}',
      '.fl-map-node:hover{border-color:var(--tb-accent-border,rgba(91,141,239,.45));box-shadow:0 7px 20px rgba(0,0,0,.3)}',
      '.fl-map-node header{display:flex;align-items:center;justify-content:space-between;color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:calc(10.5px*var(--tb-fs,1))}',
      '.fl-map-node header span{color:var(--tb-active-text,#7fa7f0);font-weight:700}',
      '.fl-map-node p{flex:1;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font-size:calc(10px*var(--tb-fs,1));line-height:1.45}',
      '.fl-map-root{min-height:84px;justify-content:center;border-color:var(--tb-accent-border,rgba(91,141,239,.45));background:rgba(91,141,239,.1)}',
      '.fl-map-root strong{color:var(--tb-text,var(--dsw-alias-label-primary,#dcdee4));font-size:calc(11px*var(--tb-fs,1))}',
      '.fl-map-root span{color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6));font-size:calc(10px*var(--tb-fs,1))}',
      '.fl-map-branch{align-self:stretch;min-height:25px;border:1px solid var(--tb-accent-border,rgba(91,141,239,.45));border-radius:6px;background:rgba(91,141,239,.11);color:var(--tb-active-text,#7fa7f0);font:inherit;font-size:calc(10px*var(--tb-fs,1));font-weight:700;cursor:pointer}',
      '.fl-map-branch:hover{background:rgba(91,141,239,.2)}',
      '.fl-turn-cell-flow{display:flex;flex-direction:column;gap:0;min-width:0}',
      '.fl-compact-diff{display:flex;flex-direction:column;gap:6px;padding:2px 0}',
      '.fl-compact-diff>div{display:grid;grid-template-columns:16px minmax(0,1fr);gap:5px;align-items:start;font-size:calc(10.5px*var(--tb-fs,1));color:var(--tb-text-2,var(--dsw-alias-label-secondary,#9a9ba6))}',
      '.fl-compact-diff span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fl-flow-two .fl-lane>div:first-child:empty,.fl-flow-two .fl-lane>div:last-child:empty{display:none}',
      '.fl-flow-two .fl-lane{grid-template-columns:minmax(180px,1fr) minmax(220px,1.2fr)}',
      '.fl-flow-two .fl-lane:has(>div:last-child:empty)>.fl-lane-main{grid-column:1/-1}',
      '.fl-zoom-badge-model{background:rgba(129,199,132,.14);color:var(--tb-done-text,#81c784);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fl-zoom-relay{flex:none;width:20px;height:18px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--tb-border-2,var(--dsw-alias-border-l2,#454650));border-radius:4px;background:transparent;color:var(--tb-text-3,var(--dsw-alias-label-tertiary,#777884));font-size:calc(11px*var(--tb-fs,1));line-height:1;cursor:pointer;font-family:inherit;opacity:0;transition:opacity .12s,color .12s,border-color .12s}',
      '.fl-zoom-branch:hover .fl-zoom-relay,.fl-zoom-rootcard:hover .fl-zoom-relay,.fl-zoom-picking .fl-zoom-relay{opacity:1}',
      '.fl-zoom-relay:hover{color:var(--tb-active-text,#7fa7f0);border-color:var(--tb-accent-border,rgba(91,141,239,.45))}',
      '.fl-zoom-picking .fl-zoom-branch:hover .fl-zoom-branch-head,.fl-zoom-picking .fl-zoom-rootcard:hover{border-color:var(--tb-accent-border,rgba(91,141,239,.45))}',
      '.fl-zoom-branch.fl-zoom-picked .fl-zoom-branch-head,.fl-zoom-card.fl-zoom-picked{border-color:var(--tb-accent,#3f6fd9);outline:2px solid var(--tb-accent,#3f6fd9);outline-offset:1px;box-shadow:0 0 0 4px var(--tb-accent-ring,rgba(91,141,239,.16))}',
      '.fl-zoom-badge-fleet{background:rgba(91,141,239,.12);color:var(--tb-active-text,#7fa7f0)}',
      '.tb-flow-zoom-relay-src{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:999px;font-size:calc(10.5px*var(--tb-fs,1));font-weight:600;background:rgba(91,141,239,.12);color:var(--tb-active-text,#7fa7f0);white-space:nowrap}',
    ].join('\n')
    ctx.effect(() => styles.insert(RT.bundleId === 'dynamic'
      ? toolboxCss
      : '@scope ([data-dsh-toolbox-scope="' + RT.domValue() + '"]) {\n' + toolboxCss + '\n}'))
    if (RT.bundleId !== 'dynamic') {
      const nav = '[data-dsh-toolbox-entry="' + RT.domValue() + '"]'
      ctx.effect(() => styles.insert([
        nav + '{width:100%;height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:0 12px;font-size:13px;display:flex;font-family:inherit;box-sizing:border-box}',
        nav + ':hover{background:var(--dsw-specific-sidebar-nav-item-hover,var(--dsw-alias-bg-layer-2,#31323b));color:var(--dsw-alias-label-primary)}',
        nav + '[data-active]{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-bg-layer-2,#31323b));color:var(--dsw-alias-label-primary);font-weight:600}',
        '[data-dsh-frame][data-sidebar-collapsed] ' + nav + '{justify-content:center;width:100%;padding:0}',
        '[data-dsh-frame][data-sidebar-collapsed] ' + nav + ' .tb-nav-label{display:none}',
        '[data-sidebar-collapsed] ' + nav + '{justify-content:center;width:100%;padding:0}',
        '[data-sidebar-collapsed] ' + nav + ' .tb-nav-label{display:none}',
      ].join('\n')))
    }

    let open = false
    const listeners = new Set()
    function emit() { listeners.forEach((fn) => { try { fn() } catch (e) {} }) }
    const store = {
      isOpen() { return open },
      toggle() { open = !open; emit() },
      close() { open = false; emit() },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    }

    const FLOW_SETTINGS_EVENT = RT.event('flow-settings-changed')
    const FLOW_PREFERENCES_KEY = RT.storageKey('flow.preferences')
    const FLOW_RULES_KEY = RT.storageKey('flow.presentation-rules')
    const FLOW_PREFERENCES_DEFAULTS = Object.freeze({
      keepOpenOnSessionSwitch: true,
      zoomEnabled: true,
      defaultBranchCount: 2,
      defaultZoomView: 'compact',
      refreshMs: 2000,
    })
    const FLOW_TEXT = Object.freeze({
        settingsTitle: 'Flowglass Settings',
        settingsSub: 'Preferences are saved only in the current browser. Built-in default rules are shipped with the package; custom rules are never saved to Git or npm.',
        behaviorSection: 'Behavior & Flow Zoom',
        keepOpenLabel: 'Keep open on session switch',
        keepOpenDesc: 'Only keeps previously opened Flowglass expanded; stays closed if explicitly dismissed.',
        zoomEnabledLabel: 'Enable Flow Zoom',
        zoomEnabledDesc: 'Hides the Flow Zoom entry button and exits Flow Zoom if currently open.',
        branchCountLabel: 'Default branch count',
        branchCountDesc: 'Used when opening the concurrent workbench for the first time in a new session.',
        branches: (n) => n + ' branches',
        zoomViewLabel: 'Flow Zoom default view',
        zoomViewDesc: 'Used when no saved view history exists.',
        viewCompact: 'Compact',
        viewDetail: 'Detail',
        viewMap: 'Mind Map',
        refreshLabel: 'Polling refresh interval',
        refreshDesc: 'Real-time event streaming remains active; disabling polling relies purely on event-driven updates.',
        refreshOff: 'Disable polling',
        refreshSec: (s) => s + 's',
        rulesSection: 'Tool Presentation Rules',
        rulesDesc: 'Matched sequentially; first matching rule takes effect. Both built-in and custom rules can be toggled, edited, or deleted.',
        addRule: 'Add Rule',
        resetRules: 'Reset to Defaults',
        noRules: 'No presentation rules configured. Saving an empty list will not restore default rules on reload.',
        discardChanges: 'Discard Changes',
        saveSettings: 'Save Settings',
        savedSuccess: 'Settings saved and applied to Flowglass in this browser.',
        ruleEnable: (i) => 'Enable rule ' + i,
        unnamedRule: 'Unnamed Rule',
        delete: 'Delete',
        rawTools: 'Raw tools (comma-separated)',
        executables: 'Executables (comma-separated)',
        displayName: 'Display Name',
        subcommands: 'Subcommands (comma-separated)',
        subcommandsPlaceholder: 'Matches any subcommand when empty',
        badge: 'Badge',
        color: 'Color',
        optional: 'Optional',
        toolTitle: 'Flowglass',
        toolDesc: 'View current session, tool calls, and subagent execution flow',
        toolboxTitle: 'Toolbox',
        toolboxDesc: 'Open workspace toolbox',
    })
    const FLOW_DEFAULT_PRESENTATION_RULES = Object.freeze([
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['git', 'git.exe'], displayName: 'Git', actions: [], badge: 'Git', color: '#f05032' },
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['gh', 'gh.exe', 'github', 'github.exe'], displayName: 'GitHub', actions: [], badge: 'GitHub', color: '#8b949e' },
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['pnpm', 'pnpm.cmd', 'pnpm.exe'], displayName: 'pnpm', actions: [], badge: 'pnpm', color: '#f69220' },
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['npm', 'npm.cmd', 'npm.exe'], displayName: 'npm', actions: [], badge: 'npm', color: '#cb3837' },
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['dsh', 'dsh.cmd', 'dsh.exe'], displayName: 'DSH', actions: [], badge: 'DSH', color: '#7fa7f0' },
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['python', 'python.exe', 'python3', 'python3.exe', 'py', 'py.exe'], displayName: 'Python', actions: [], badge: 'Python', color: '#3776ab' },
    ])
    const flowDefaultPresentationRules = JSON.stringify(FLOW_DEFAULT_PRESENTATION_RULES)
    const cloneFlowRules = (rules) => JSON.parse(JSON.stringify(rules))
    const normalizeFlowPreferences = (value) => {
      const p = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const branchCount = Number(p.defaultBranchCount)
      const refreshMs = Number(p.refreshMs)
      return {
        keepOpenOnSessionSwitch: p.keepOpenOnSessionSwitch !== false,
        zoomEnabled: p.zoomEnabled !== false,
        defaultBranchCount: branchCount === 3 || branchCount === 4 ? branchCount : 2,
        defaultZoomView: p.defaultZoomView === 'detail' || p.defaultZoomView === 'map' ? p.defaultZoomView : 'compact',
        refreshMs: [0, 1000, 2000, 5000, 10000].includes(refreshMs) ? refreshMs : 2000,
      }
    }
    const readFlowPreferences = () => {
      try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(FLOW_PREFERENCES_KEY)
        return normalizeFlowPreferences(raw ? JSON.parse(raw) : FLOW_PREFERENCES_DEFAULTS)
      } catch (e) { return normalizeFlowPreferences(FLOW_PREFERENCES_DEFAULTS) }
    }
    const splitFlowRuleList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
    const normalizeFlowRulesForStorage = (value) => {
      const rules = typeof value === 'string' ? JSON.parse(value || '[]') : value
      if (!Array.isArray(rules) || rules.length > 24) throw new Error('Presentation rules must be an array with at most 24 entries')
      return rules.map((rule, index) => {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('Presentation rule ' + (index + 1) + ' is invalid')
        const tools = Array.isArray(rule.tools) ? rule.tools.map(String).map((item) => item.trim()).filter(Boolean) : []
        const executables = Array.isArray(rule.executables) ? rule.executables.map(String).map((item) => item.trim()).filter(Boolean) : []
        if (!tools.length || !executables.length) throw new Error('Rule ' + (index + 1) + ' requires raw tools and executables')
        const color = String(rule.color || '#81c784').toLowerCase()
        if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error('Rule ' + (index + 1) + ' has an invalid color')
        return {
          enabled: rule.enabled !== false,
          tools: [...new Set(tools)].slice(0, 8),
          executables: [...new Set(executables)].slice(0, 12),
          displayName: String(rule.displayName || '').trim().slice(0, 80),
          actions: [...new Set(Array.isArray(rule.actions) ? rule.actions.map(String).map((item) => item.trim()).filter(Boolean) : [])].slice(0, 32),
          badge: String(rule.badge || '').trim().slice(0, 12),
          color,
        }
      })
    }
    const readFlowRules = () => {
      try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(FLOW_RULES_KEY)
        return typeof raw === 'string' ? raw : flowDefaultPresentationRules
      } catch (e) { return flowDefaultPresentationRules }
    }
    const readFlowRuleObjects = () => {
      try { return normalizeFlowRulesForStorage(readFlowRules()) }
      catch (e) { return cloneFlowRules(FLOW_DEFAULT_PRESENTATION_RULES) }
    }
    const writeFlowRules = (raw) => {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(FLOW_RULES_KEY, raw)
    }
    const writeFlowSettings = (preferences, rules) => {
      const nextPreferences = normalizeFlowPreferences(preferences)
      const nextRules = normalizeFlowRulesForStorage(rules)
      if (typeof localStorage === 'undefined') throw new Error('This browser does not support local settings')
      localStorage.setItem(FLOW_PREFERENCES_KEY, JSON.stringify(nextPreferences))
      localStorage.setItem(FLOW_RULES_KEY, JSON.stringify(nextRules))
      try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FLOW_SETTINGS_EVENT)) } catch (e) {}
      return { preferences: nextPreferences, rules: nextRules }
    }

    const FLOW_TAB_ID = 'dsh-flowglass-en:flow'
    const FLOW_NATIVE_ID = 'dsh-flowglass-en/native'
    const FLOW_NATIVE_KIND = 'dsh-flowglass-en:flow'
    const TOOLBOX_NATIVE_ID = 'dsh-dynamic-toolbox/native'
    const TOOLBOX_NATIVE_KIND = 'dsh-dynamic-toolbox:toolbox'
    const OFFICIAL_TOOLBOX_ONLY = RT.bundleId === 'dynamic-toolbox'
    const integrationListeners = new Set()
    const integration = {
      service: null,
      native: false,
      enabled: true,
      active() { return this.native || (Boolean(this.service) && this.enabled) },
      emit() { integrationListeners.forEach((fn) => { try { fn() } catch (e) {} }) },
      subscribe(fn) { integrationListeners.add(fn); return () => integrationListeners.delete(fn) },
      sync(service) {
        this.service = service || null
        this.enabled = !service || typeof service.isTabEnabled !== 'function' || service.isTabEnabled(FLOW_TAB_ID) !== false
        if (this.active()) store.close()
        this.emit()
      },
      setNative(on) {
        const next = Boolean(on)
        if (this.native === next) return
        this.native = next
        if (this.active()) store.close()
        this.emit()
      },
    }
    let nativeOpenTab = null
    let nativeFlowVisible = false
    let nativeFlowReopenSession = ''

    function useIntegrationActive() {
      const [, force] = React.useState(0)
      React.useEffect(() => integration.subscribe(() => force((t) => t + 1)), [])
      return integration.active()
    }

    function useOpenState() {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((t) => t + 1)), [])
      return store.isOpen()
    }

    function Entry(props) {
      const isOpen = useOpenState()
      const sidebarActive = useIntegrationActive()
      const nativeActive = integration.native
      if (sidebarActive && !nativeActive) return null
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'tb-entry' + (isOpen && !nativeActive ? ' tb-entry-active' : ''),
          title: fullDisplayName + (nativeActive ? ' (Flowglass)' : ' (tool)'),
          onClick: () => {
            if (nativeActive && nativeOpenTab) { try { nativeOpenTab() } catch (e) {} return }
            store.toggle()
          },
        },
        props.wide ? compactDisplayName : 'TB',
      )
    }

    const NAV_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="12" height="8.5" rx="1.5"/><path d="M5.5 5V3.8A1.3 1.3 0 0 1 6.8 2.5h2.4A1.3 1.3 0 0 1 10.5 3.8V5"/><path d="M2 8.2h12"/></svg>'
    const FLOW_NAV_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="3" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><path d="M8 4.5v2.2M8 6.7L4 11M8 6.7l4 4.3"/></svg>'
    const ENTRY_NAV_ICON = RT.bundleId === 'flowglass-en' ? FLOW_NAV_ICON : NAV_ICON
    const NAV_FAMILY_SEL = '[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-toolbox-entry]'
    let sidebarIconEl = null
    let desiredSidebarIcon = ENTRY_NAV_ICON
    const applySidebarIcon = () => { if (sidebarIconEl) { try { sidebarIconEl.innerHTML = desiredSidebarIcon } catch (e) {} } }
    const replaceSidebarIcon = (html) => { desiredSidebarIcon = html || ENTRY_NAV_ICON; applySidebarIcon() }

    function mountSidebarEntry() {
      function sidebarRoot() {
        const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
        if (!column) return undefined
        const logoRow = column.querySelector('[class*="logoRow"]')
        return (logoRow && logoRow.parentElement) || column.firstElementChild || undefined
      }
      function newSessionButton(root) {
        const nested = root.querySelector('button[class*="newSession"]')
        if (nested) return nested
        for (const child of root.children) {
          if (child.tagName === 'BUTTON') return child
        }
        return undefined
      }
      function placeEntry(root, entry) {
        const button = newSessionButton(root)
        if (!button) return false
        if (entry.parentElement !== root) {
          const row = button.closest('[class*="logoRow"]')
          const base = (row && row.parentElement === root) ? row : button
          const family = Array.prototype.filter.call(root.children, (el) => el.matches && el.matches(NAV_FAMILY_SEL))
          const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling
          root.insertBefore(entry, anchor)
        }
        return true
      }

      const entry = document.createElement('button')
      entry.type = 'button'
      entry.setAttribute('data-dsh-toolbox-entry', RT.domValue())
      entry.setAttribute('aria-label', fullDisplayName)
      entry.setAttribute('title', fullDisplayName)
      const safeLabel = compactDisplayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      entry.innerHTML = '<span class="tb-nav-icon">' + ENTRY_NAV_ICON + '</span><span class="tb-nav-label">' + safeLabel + '</span>'
      const iconEl = entry.querySelector('.tb-nav-icon')
      sidebarIconEl = iconEl
      applySidebarIcon()
      entry.addEventListener('click', () => {
        if (integration.native && nativeOpenTab) { try { nativeOpenTab() } catch (e) {} return }
        store.toggle()
      })

      let root
      let placed = false
      function tryPlace() {
        if (root && !root.isConnected) { rootObserver.disconnect(); root = undefined; placed = false }
        if (placed) {
          if (document.body.contains(entry)) return
          rootObserver.disconnect(); root = undefined; placed = false
        }
        if (!root) root = sidebarRoot()
        if (!root) return
        placed = placeEntry(root, entry)
        if (placed) rootObserver.observe(root, { childList: true, subtree: true })
      }

      const waitObserver = new MutationObserver(() => { tryPlace() })
      waitObserver.observe(document.body, { childList: true, subtree: true })
      const rootObserver = new MutationObserver(() => {
        if (!root || !root.isConnected) { placed = false; tryPlace(); return }
        if (!root.contains(entry)) placed = placeEntry(root, entry)
      })

      const syncActive = () => {
        if (store.isOpen()) entry.setAttribute('data-active', 'true')
        else entry.removeAttribute('data-active')
        if (!entry.style) return
        if (integration.active() && !integration.native) entry.style.display = 'none'
        else entry.style.display = ''
      }
      const unsubscribe = store.subscribe(syncActive)
      const unsubscribeIntegration = integration.subscribe(syncActive)
      syncActive()
      tryPlace()

      return () => {
        waitObserver.disconnect()
        rootObserver.disconnect()
        unsubscribe()
        unsubscribeIntegration()
        if (sidebarIconEl === iconEl) sidebarIconEl = null
        entry.remove()
      }
    }

    const MIN_W = 360
    const MIN_H = 240
    const SNAP_THRESHOLD = 120
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

    const fetchTools = (root) => host.call(RT.rpc('tools'), { root: root || undefined })
      .then((r) => (r && r.ok && Array.isArray(r.tools) ? r.tools : []))
      .catch(() => [])

    const LS_KEY = RT.storageKey('drawer')
    const lsRead = () => {
      try {
        if (typeof localStorage === 'undefined') return null
        const raw = localStorage.getItem(LS_KEY)
        if (!raw) return null
        const p = JSON.parse(raw)
        return p && typeof p === 'object' ? p : null
      } catch (e) { return null }
    }
    const lsWrite = (patch) => {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(lsRead() || {}, patch)))
      } catch (e) {}
    }

    const TOOL_CATS = [
      { id: 'ai', label: 'AI' },
      { id: 'dev', label: 'Development' },
      { id: 'session', label: 'session' },
      { id: 'system', label: 'System' },
    ]
    const DEFAULT_CAT = {
      aiassist: 'ai', aiusage: 'ai', quota: 'ai',
      jira: 'dev', git: 'dev', files: 'dev', http: 'dev', ports: 'dev', calc: 'dev',
      trace: 'session', usage: 'session', prompt: 'session', context: 'session', search: 'session', lineage: 'session', tools: 'session', flow: 'session', flowedit: 'session',
      toolbox: 'system', selfview: 'system',
    }
    const CATS_LS_KEY = RT.storageKey('cats')
    let lastNav = null
    const catsRead = () => {
      try {
        if (typeof localStorage === 'undefined') return null
        const raw = localStorage.getItem(CATS_LS_KEY)
        if (!raw) return null
        const p = JSON.parse(raw)
        return p && typeof p === 'object' ? p : null
      } catch (e) { return null }
    }
    const catsWrite = (patch) => {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(CATS_LS_KEY, JSON.stringify(Object.assign(catsRead() || {}, patch)))
      } catch (e) {}
    }

    const APPEARANCE_PRESETS = { default: '', teal: '#0d9488', amber: '#d97706' }
    const APPEARANCE_PRESET_VARS = {
      teal: ['--tb-accent:#0d9488', '--tb-accent-hover:#14b8a6', '--tb-accent-text:#5eead4', '--tb-accent-bg:rgba(20,184,166,.14)', '--tb-accent-border:rgba(20,184,166,.45)', '--tb-accent-ring:rgba(20,184,166,.16)', '--tb-active:#14b8a6', '--tb-active-text:#5eead4', '--tb-active-border:rgba(20,184,166,.4)', '--tb-active-bg:rgba(20,184,166,.12)'],
      amber: ['--tb-accent:#d97706', '--tb-accent-hover:#f59e0b', '--tb-accent-text:#fbbf24', '--tb-accent-bg:rgba(245,158,11,.14)', '--tb-accent-border:rgba(245,158,11,.45)', '--tb-accent-ring:rgba(245,158,11,.16)', '--tb-active:#f59e0b', '--tb-active-text:#fbbf24', '--tb-active-border:rgba(245,158,11,.4)', '--tb-active-bg:rgba(245,158,11,.12)'],
    }
    const APP_LS_KEY = RT.storageKey('appearance')
    // Keep the UI sliders aligned with the persisted validation contract. The
    // old UI exposed a narrower range than the reader accepted, which made
    // some valid stored values impossible to select or reset from the panel.
    const APPEARANCE_SCALE_MIN = 0.7
    const APPEARANCE_SCALE_MAX = 2
    const APPEARANCE_RAIL_MIN = 240
    const APPEARANCE_RAIL_MAX = 1200
    const APPEARANCE_PERSIST_DEBOUNCE_MS = 150
    const appearanceClampScale = (v, dft) => {
      const n = Number(v)
      return Number.isFinite(n)
        ? Math.min(APPEARANCE_SCALE_MAX, Math.max(APPEARANCE_SCALE_MIN, Math.round(n * 100) / 100))
        : dft
    }
    const appearanceClampRailW = (v) => {
      const n = Number(v)
      return Number.isFinite(n) && n >= APPEARANCE_RAIL_MIN && n <= APPEARANCE_RAIL_MAX ? Math.round(n) : 0
    }
    const appearanceDefaults = () => ({ preset: 'default', accent: '', uiScale: 1, detailScale: 1, railW: 0 })
    const normalizeAppearance = (value) => {
      const dft = appearanceDefaults()
      const p = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      return {
        preset: Object.prototype.hasOwnProperty.call(APPEARANCE_PRESETS, p.preset) ? p.preset : dft.preset,
        accent: typeof p.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.accent) ? p.accent : '',
        uiScale: appearanceClampScale(p.uiScale, dft.uiScale),
        detailScale: appearanceClampScale(p.detailScale, dft.detailScale),
        railW: appearanceClampRailW(p.railW),
      }
    }
    const readAppearanceStorage = () => {
      try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(APP_LS_KEY)
        return normalizeAppearance(raw ? JSON.parse(raw) : null)
      } catch (e) { return appearanceDefaults() }
    }
    let appearanceState = readAppearanceStorage()
    const appearanceListeners = new Set()
    let appearancePersistTimer = null
    const appearanceRead = () => appearanceState
    const persistAppearance = () => {
      appearancePersistTimer = null
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(APP_LS_KEY, JSON.stringify(appearanceState))
      } catch (e) {}
    }
    const scheduleAppearancePersist = () => {
      if (appearancePersistTimer !== null) clearTimeout(appearancePersistTimer)
      appearancePersistTimer = setTimeout(persistAppearance, APPEARANCE_PERSIST_DEBOUNCE_MS)
    }
    const appearanceWrite = (patch) => {
      appearanceState = normalizeAppearance(Object.assign({}, appearanceState, patch))
      scheduleAppearancePersist()
      appearanceListeners.forEach((fn) => { try { fn() } catch (e) {} })
    }
    const appearanceSubscribe = (fn) => {
      appearanceListeners.add(fn)
      return () => appearanceListeners.delete(fn)
    }
    // Keep multiple DSH windows in sync. The active window still updates
    // immediately through appearanceWrite; this listener covers writes from
    // another window/tab without changing the existing storage key.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const onAppearanceStorage = (event) => {
        if (!event || event.key !== APP_LS_KEY) return
        try {
          const next = event.newValue ? normalizeAppearance(JSON.parse(event.newValue)) : appearanceDefaults()
          if (appearancePersistTimer !== null) {
            clearTimeout(appearancePersistTimer)
            appearancePersistTimer = null
          }
          appearanceState = next
        } catch (e) { return }
        appearanceListeners.forEach((fn) => { try { fn() } catch (e) {} })
      }
      window.addEventListener('storage', onAppearanceStorage)
      ctx.effect(() => () => {
        window.removeEventListener('storage', onAppearanceStorage)
        if (appearancePersistTimer !== null) {
          clearTimeout(appearancePersistTimer)
          persistAppearance()
        }
      })
    }
    function useAppearance() {
      const [, force] = React.useState(0)
      React.useEffect(() => appearanceSubscribe(() => force((t) => t + 1)), [])
      return appearanceState
    }
    function accentFamilyVars(hex) {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
      const rgb = r + ',' + g + ',' + b
      const lift = (t) => '#' + [r, g, b].map((c) => ('0' + Math.round(c + (255 - c) * t).toString(16)).slice(-2)).join('')
      return [
        '--tb-accent:' + hex,
        '--tb-accent-hover:' + lift(0.12),
        '--tb-accent-text:' + lift(0.38),
        '--tb-accent-bg:rgba(' + rgb + ',.14)',
        '--tb-accent-border:rgba(' + rgb + ',.45)',
        '--tb-accent-ring:rgba(' + rgb + ',.16)',
        '--tb-active:' + lift(0.06),
        '--tb-active-text:' + lift(0.38),
        '--tb-active-border:rgba(' + rgb + ',.4)',
        '--tb-active-bg:rgba(' + rgb + ',.12)',
      ]
    }
    function appearanceCss() {
      const decls = ['--tb-fs:' + appearanceState.uiScale, '--tb-fs-detail:' + appearanceState.detailScale]
      if (appearanceState.railW) decls.push('--fl-rail-w:' + appearanceState.railW + 'px')
      if (appearanceState.accent) decls.push.apply(decls, accentFamilyVars(appearanceState.accent))
      else if (APPEARANCE_PRESET_VARS[appearanceState.preset]) decls.push.apply(decls, APPEARANCE_PRESET_VARS[appearanceState.preset])
      const sel = RT.bundleId === 'dynamic' ? ':root' : '[data-dsh-toolbox-scope="' + RT.domValue() + '"]'
      return sel + '{' + decls.join(';') + '}'
    }
    let appearanceDispose = null
    const appearanceRender = () => {
      if (appearanceDispose) { try { appearanceDispose() } catch (e) {} appearanceDispose = null }
      try { appearanceDispose = styles.insert(appearanceCss()) } catch (e) {}
    }
    appearanceRender()
    ctx.effect(() => {
      const off = appearanceSubscribe(() => appearanceRender())
      return () => {
        off()
        if (appearanceDispose) { try { appearanceDispose() } catch (e) {} appearanceDispose = null }
      }
    })

    function AppearancePanel() {
      const a = useAppearance()
      const rowStyle = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
      const lblStyle = { fontSize: '11px', opacity: 0.7, minWidth: '58px' }
      const numStyle = { fontSize: '11px', opacity: 0.75, minWidth: '40px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
      const chipBase = { height: '22px', padding: '0 10px', borderRadius: '999px', border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '11.5px', fontFamily: 'inherit', lineHeight: '1' }
      const sliderRow = (label, key, min, max) => React.createElement('div', { style: rowStyle },
        React.createElement('span', { style: lblStyle }, label),
        React.createElement('input', {
          type: 'range', min: min, max: max, step: 0.05, value: String(a[key]),
          title: label + 'scale (100% = built-in default)',
          style: { flex: '1', minWidth: '110px', accentColor: 'var(--tb-accent,#3f6fd9)' },
          onChange: (e) => appearanceWrite({ [key]: Number(e.target.value) }),
        }),
        React.createElement('span', { style: numStyle }, Math.round(a[key] * 100) + '%'),
        Math.abs(a[key] - 1) > 0.001
          ? React.createElement('button', {
            type: 'button', style: Object.assign({}, chipBase, { padding: '0 6px', opacity: 0.65 }),
            title: 'Reset to 100%', onClick: () => appearanceWrite({ [key]: 1 }),
          }, '↺')
          : null,
      )
      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        React.createElement('div', { style: rowStyle },
          React.createElement('span', { style: lblStyle }, 'Theme'),
          Object.keys(APPEARANCE_PRESETS).map((k) => {
            const active = !a.accent && a.preset === k
            return React.createElement('button', {
              key: k, type: 'button',
              title: k === 'default' ? 'Built-in default blue' : k === 'teal' ? 'Teal (original theme plugin color)' : 'Warm orange (original theme plugin color)',
              style: Object.assign({}, chipBase, active ? { borderColor: 'var(--tb-accent,#3f6fd9)', color: 'var(--tb-accent-text,#7fa7f0)', fontWeight: 600 } : null),
              onClick: () => appearanceWrite({ preset: k }),
            }, (k === 'default' ? 'Default' : k === 'teal' ? 'Teal' : 'Warm orange') + (APPEARANCE_PRESETS[k] ? '' : ''))
          }),
          React.createElement('input', {
            type: 'color', value: a.accent || APPEARANCE_PRESETS[a.preset] || '#3f6fd9',
            title: 'Customaccent (First Theme)',
            onChange: (e) => appearanceWrite({ accent: e.target.value }),
            style: { width: '26px', height: '22px', padding: '0', border: '1px solid rgba(128,128,128,.45)', borderRadius: '5px', background: 'transparent', cursor: 'pointer' },
          }),
          a.accent
            ? React.createElement('button', {
              type: 'button', style: Object.assign({}, chipBase, { padding: '0 8px', opacity: 0.75 }),
              title: 'ClearCustomaccent,toTheme', onClick: () => appearanceWrite({ accent: '' }),
            }, '✕ Custom')
            : null,
        ),
        sliderRow('interfacefont size', 'uiScale', APPEARANCE_SCALE_MIN, APPEARANCE_SCALE_MAX),
        sliderRow('detailsfont size', 'detailScale', APPEARANCE_SCALE_MIN, APPEARANCE_SCALE_MAX),
        React.createElement('div', { style: rowStyle },
          React.createElement('span', { style: lblStyle }, 'detailswidth'),
          React.createElement('input', {
            type: 'range', min: APPEARANCE_RAIL_MIN, max: APPEARANCE_RAIL_MAX, step: 10, value: String(a.railW || 350),
            title: 'Detail side-panel width (drag its left edge to resize; saved automatically)',
            style: { flex: '1', minWidth: '110px', accentColor: 'var(--tb-accent,#3f6fd9)' },
            onChange: (e) => appearanceWrite({ railW: Number(e.target.value) }),
          }),
          React.createElement('span', { style: numStyle }, a.railW ? a.railW + 'px' : 'Default'),
          React.createElement('button', {
            type: 'button', style: Object.assign({}, chipBase, { padding: '0 6px', opacity: 0.65 }),
            title: 'Restore default 350px', onClick: () => appearanceWrite({ railW: 0 }),
          }, '↺'),
        ),
        React.createElement('div', {
          style: { border: '1px solid rgba(128,128,128,.35)', borderRadius: '6px', padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: '5px', background: 'rgba(128,128,128,.07)' },
        },
          React.createElement('span', { style: { fontSize: '10px', opacity: 0.6, letterSpacing: '.4px' } }, 'Preview (updates while dragging)'),
          React.createElement('div', { style: { fontSize: (12.5 * a.uiScale).toFixed(1) + 'px', lineHeight: 1.5 } },
            'interface Aa123 — button / label / messagePreview'),
          React.createElement('div', {
            style: {
              fontFamily: 'ui-monospace,Consolas,monospace', fontSize: (12 * a.detailScale).toFixed(1) + 'px', lineHeight: 1.5,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', border: '1px solid rgba(128,128,128,.35)', borderRadius: '5px', padding: '4px 6px',
            },
          }, ' · full input {"seq": 12}\n · full response text detail example Aa123'),
        ),
      )
    }

    function BetterSidebarFlowSettings() {
      const headStyle = { fontSize: '11px', fontWeight: 600, opacity: 0.7, letterSpacing: '.4px' }
      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12.5px' } },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          React.createElement('span', { style: headStyle }, 'Appearance (Theme / accent / font size)'),
          React.createElement(AppearancePanel, null),
        ),
      )
    }

    function FlowglassPluginSettings() {
      const initialPreferences = React.useMemo ? React.useMemo(() => readFlowPreferences(), []) : readFlowPreferences()
      const initialRules = React.useMemo ? React.useMemo(() => readFlowRuleObjects(), []) : readFlowRuleObjects()
      const [preferences, setPreferences] = React.useState(initialPreferences)
      const [rules, setRules] = React.useState(initialRules)
      const [savedKey, setSavedKey] = React.useState(() => JSON.stringify({ preferences: initialPreferences, rules: initialRules }))
      const [notice, setNotice] = React.useState(null)
      const currentKey = JSON.stringify({ preferences, rules })
      const dirty = currentKey !== savedKey
      const h = React.createElement
      const UiButton = flowUiPrimitives && flowUiPrimitives.Button
      const UiSwitch = flowUiPrimitives && flowUiPrimitives.Switch
      const UiInput = flowUiPrimitives && flowUiPrimitives.Input
      const button = (props, child) => UiButton
        ? h(UiButton, { variant: props.primary ? 'primary' : 'outline', size: 'sm', ...props, primary: undefined }, child)
        : h('button', { type: 'button', ...props, primary: undefined }, child)
      const setPreference = (key, value) => {
        setPreferences((current) => ({ ...current, [key]: value }))
        setNotice(null)
      }
      const setRule = (index, patch) => {
        setRules((current) => current.map((rule, at) => at === index ? { ...rule, ...patch } : rule))
        setNotice(null)
      }
      const toggle = (label, value, onChange) => UiSwitch
        ? h(UiSwitch, { checked: value, onChange, label })
        : h('button', {
          type: 'button', role: 'switch', 'aria-label': label, 'aria-checked': value ? 'true' : 'false',
          className: 'fg-settings-toggle' + (value ? ' is-on' : ''), onClick: () => onChange(!value),
        }, h('span', null))
      const option = (value, label) => h('option', { key: String(value), value: String(value) }, label)
      const preferenceRow = (title, description, control) => h('div', { className: 'fg-settings-row' },
        h('span', { className: 'fg-settings-copy' }, h('strong', null, title), h('small', null, description)),
        control,
      )
      const reloadStaged = () => {
        const nextPreferences = readFlowPreferences()
        const nextRules = readFlowRuleObjects()
        setPreferences(nextPreferences)
        setRules(nextRules)
        setSavedKey(JSON.stringify({ preferences: nextPreferences, rules: nextRules }))
        setNotice(null)
      }
      const save = (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        try {
          const saved = writeFlowSettings(preferences, rules)
          const nextRules = cloneFlowRules(saved.rules)
          setPreferences(saved.preferences)
          setRules(nextRules)
          setSavedKey(JSON.stringify({ preferences: saved.preferences, rules: nextRules }))
          setNotice({ error: false, text: FLOW_TEXT.savedSuccess })
        } catch (error) {
          setNotice({ error: true, text: String((error && error.message) || error) })
        }
      }
      const ruleCards = rules.map((rule, index) => {
        const title = rule.displayName || rule.executables[0] || FLOW_TEXT.unnamedRule
        const input = (label, key, value, placeholder, list) => h('label', { key },
          h('span', null, label),
          h(UiInput || 'input', {
            className: 'fg-settings-input' + (UiInput ? ' is-official' : ''), value, placeholder,
            onChange: (event) => setRule(index, { [key]: list ? splitFlowRuleList(event.currentTarget.value) : event.currentTarget.value }),
          }),
        )
        return h('article', { key: index, className: 'fg-settings-rule' + (rule.enabled ? '' : ' is-off') },
          h('div', { className: 'fg-settings-rule-head' },
            toggle(FLOW_TEXT.ruleEnable(index + 1), rule.enabled, (enabled) => setRule(index, { enabled })),
            h('span', { className: 'fl-rule-dot', style: { background: rule.color } }),
            h('strong', null, title),
            button({
              type: 'button', className: 'fg-settings-button danger',
              onClick: () => { setRules((current) => current.filter((_item, at) => at !== index)); setNotice(null) },
            }, FLOW_TEXT.delete),
          ),
          h('div', { className: 'fg-settings-rule-grid' },
            input(FLOW_TEXT.rawTools, 'tools', (rule.tools || []).join(', '), 'pwsh, bash', true),
            input(FLOW_TEXT.executables, 'executables', (rule.executables || []).join(', '), 'git, git.exe', true),
            input(FLOW_TEXT.displayName, 'displayName', rule.displayName || '', FLOW_TEXT.optional, false),
            input(FLOW_TEXT.subcommands, 'actions', (rule.actions || []).join(', '), FLOW_TEXT.subcommandsPlaceholder, true),
            input(FLOW_TEXT.badge, 'badge', rule.badge || '', FLOW_TEXT.optional, false),
            h('label', { key: 'color' }, h('span', null, FLOW_TEXT.color), h('input', {
              type: 'color', className: 'fg-settings-color', value: rule.color || '#81c784',
              onChange: (event) => setRule(index, { color: event.currentTarget.value }),
            })),
          ),
        )
      })
      return h('div', { 'data-dsh-toolbox-scope': RT.domValue() },
        h('form', { className: 'fg-settings', onSubmit: save },
          h('div', { className: 'fg-settings-head' },
            h('div', null,
              h('h2', { className: 'fg-settings-title' }, FLOW_TEXT.settingsTitle),
              h('p', { className: 'fg-settings-sub' }, FLOW_TEXT.settingsSub),
            ),
          ),
          h('section', { className: 'fg-settings-section' },
            h('div', { className: 'fg-settings-section-head' }, h('h3', null, FLOW_TEXT.behaviorSection)),
            h('div', { className: 'fg-settings-grid' },
              preferenceRow(FLOW_TEXT.keepOpenLabel, FLOW_TEXT.keepOpenDesc,
                toggle(FLOW_TEXT.keepOpenLabel, preferences.keepOpenOnSessionSwitch, (value) => setPreference('keepOpenOnSessionSwitch', value))),
              preferenceRow(FLOW_TEXT.zoomEnabledLabel, FLOW_TEXT.zoomEnabledDesc,
                toggle(FLOW_TEXT.zoomEnabledLabel, preferences.zoomEnabled, (value) => setPreference('zoomEnabled', value))),
              preferenceRow(FLOW_TEXT.branchCountLabel, FLOW_TEXT.branchCountDesc,
                h('select', { className: 'fg-settings-select', value: String(preferences.defaultBranchCount), onChange: (event) => setPreference('defaultBranchCount', Number(event.currentTarget.value)) },
                  option(2, FLOW_TEXT.branches(2)), option(3, FLOW_TEXT.branches(3)), option(4, FLOW_TEXT.branches(4)))),
              preferenceRow(FLOW_TEXT.zoomViewLabel, FLOW_TEXT.zoomViewDesc,
                h('select', { className: 'fg-settings-select', value: preferences.defaultZoomView, onChange: (event) => setPreference('defaultZoomView', event.currentTarget.value) },
                  option('compact', FLOW_TEXT.viewCompact), option('detail', FLOW_TEXT.viewDetail), option('map', FLOW_TEXT.viewMap))),
              preferenceRow(FLOW_TEXT.refreshLabel, FLOW_TEXT.refreshDesc,
                h('select', { className: 'fg-settings-select', value: String(preferences.refreshMs), onChange: (event) => setPreference('refreshMs', Number(event.currentTarget.value)) },
                  option(0, FLOW_TEXT.refreshOff), option(1000, FLOW_TEXT.refreshSec(1)), option(2000, FLOW_TEXT.refreshSec(2)), option(5000, FLOW_TEXT.refreshSec(5)), option(10000, FLOW_TEXT.refreshSec(10)))),
            ),
          ),
          h('section', { className: 'fg-settings-section' },
            h('div', { className: 'fg-settings-section-head' },
              h('div', null, h('h3', null, FLOW_TEXT.rulesSection), h('p', { className: 'fg-settings-note' }, FLOW_TEXT.rulesDesc)),
              h('div', { className: 'fg-settings-actions' },
                button({
                  type: 'button', className: 'fg-settings-button', disabled: rules.length >= 24,
                  onClick: () => { setRules((current) => [...current, { enabled: true, tools: ['pwsh'], executables: [], displayName: '', actions: [], badge: '', color: '#81c784' }]); setNotice(null) },
                }, FLOW_TEXT.addRule),
                button({ type: 'button', className: 'fg-settings-button', onClick: () => { setRules(cloneFlowRules(FLOW_DEFAULT_PRESENTATION_RULES)); setNotice(null) } }, FLOW_TEXT.resetRules),
              ),
            ),
            h('div', { className: 'fg-settings-rules' }, ruleCards.length ? ruleCards : h('p', { className: 'fg-settings-note' }, FLOW_TEXT.noRules)),
          ),
          h('div', { className: 'fg-settings-actions' },
            notice ? h('span', { className: 'fg-settings-status' + (notice.error ? ' is-error' : ''), role: notice.error ? 'alert' : 'status' }, notice.text) : null,
            button({ type: 'button', className: 'fg-settings-button', disabled: !dirty, onClick: reloadStaged }, FLOW_TEXT.discardChanges),
            button({ type: 'submit', primary: true, className: 'fg-settings-button primary', disabled: !dirty }, FLOW_TEXT.saveSettings),
          ),
        ),
      )
    }


    function HRow(props) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const node = ref.current
        if (!node) return undefined
        const onWheel = (e) => {
          if (!e.deltaY || e.deltaX) return
          node.scrollLeft += e.deltaY
          e.preventDefault()
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => { try { node.removeEventListener('wheel', onWheel) } catch (e) {} }
      }, [])
      return React.createElement('div', { className: props.className, ref }, props.children)
    }

    function Drawer(props) {
      const drawerOpen = useOpenState()
      const sidebarActive = useIntegrationActive()
      const embedded = Boolean(props.embedded)
      const isOpen = embedded ? props.visible !== false : drawerOpen
      const [dockMode, setDockMode] = React.useState(() => {
        if (RT.bundleId === 'flowglass-en') return 'right'
        const s = lsRead()
        if (s && (s.dockMode === 'right' || s.dockMode === 'full' || s.dockMode === 'float')) {
          return s.dockMode
        }
        return (s && s.docked === false) ? 'float' : 'right'
      })
      const docked = dockMode !== 'float'
      const setDocked = (v) => setDockMode(v ? 'right' : 'float')
      const [pos, setPos] = React.useState(() => { const s = lsRead(); return s && s.pos && typeof s.pos.x === 'number' && typeof s.pos.y === 'number' ? s.pos : null })
      const [drag, setDrag] = React.useState(null)
      const [width, setWidth] = React.useState(() => { const s = lsRead(); return s && typeof s.width === 'number' ? s.width : null })
      const [height, setHeight] = React.useState(() => { const s = lsRead(); return s && typeof s.height === 'number' ? s.height : null })
      const [snapHint, setSnapHint] = React.useState(false)
      const [resize, setResize] = React.useState(null)
      const [tools, setTools] = React.useState([])
      const toolsRef = React.useRef([])
      toolsRef.current = tools
      const [active, setActive] = React.useState(() => { const s = lsRead(); return s && typeof s.active === 'string' ? s.active : null })
      const [autoMs, setAutoMs] = React.useState({})
      const [tabBadges, setTabBadges] = React.useState({})
      const [html, setHtml] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [copied, setCopied] = React.useState(null)
      const [flowMarkdownPreviewKey, setFlowMarkdownPreviewKey] = React.useState(null)
      const flowMarkdownDisabledKeyRef = React.useRef(null)
      const [flowMarkdownPortal, setFlowMarkdownPortal] = React.useState(null)
      const [busyTool, setBusyTool] = React.useState(null)
      const [showJumpLatest, setShowJumpLatest] = React.useState(false)
      const [flowZoom, setFlowZoom] = React.useState(() => {
        try { const n = Number(localStorage.getItem(RT.storageKey('flow.zoom'))); return n >= 60 && n <= 150 ? n : 100 } catch (e) { return 100 }
      })
      const [flowZen, setFlowZen] = React.useState(false)
      const [flowSelectedSeqs, setFlowSelectedSeqs] = React.useState([])
      const [flowTargetSession, setFlowTargetSession] = React.useState('')
      const [flowBringPopup, setFlowBringPopup] = React.useState(false)
      const [flowAddPopup, setFlowAddPopup] = React.useState(false)
      const [flowAddTargetSession, setFlowAddTargetSession] = React.useState('')
      const [flowAddAnchor, setFlowAddAnchor] = React.useState(null)
      const [flowTreeOpen, setFlowTreeOpen] = React.useState({})
      const [flowUiBusy, setFlowUiBusy] = React.useState(false)
      const [flowUiNotice, setFlowUiNotice] = React.useState('')
      const [zoomPick, setZoomPick] = React.useState([])
      const [zoomRelay, setZoomRelay] = React.useState(null) // { source, text } | null
      const zoomPromptRef = React.useRef('')
      const flowMindMapPositionsRef = React.useRef(new Map())
      const readSessionsSnapshot = () => {
        if (RT.bundleId !== 'flowglass-en') return undefined
        try {
          const list = sessionsClient && sessionsClient.list
          return list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : undefined
        } catch (e) { return undefined }
      }
      const [serviceSessionsSnapshot, setServiceSessionsSnapshot] = React.useState(readSessionsSnapshot)
      const [managing, setManaging] = React.useState(false)
      const [plugins, setPlugins] = React.useState([])
      const [pluginCaps, setPluginCaps] = React.useState(null)
      const canRebuildFromDisk = !pluginCaps || pluginCaps.rebuildFromDisk !== false
      const canAiUsage = !pluginCaps || pluginCaps.aiUsage !== false
      const [rebuilding, setRebuilding] = React.useState(false)
      const [rebuildLines, setRebuildLines] = React.useState(null)
      const [rebuildHistory, setRebuildHistory] = React.useState([])
      const [aiUsage, setAiUsage] = React.useState(null)
      const [pluginFilter, setPluginFilter] = React.useState('')
      const [hideHostOnly, setHideHostOnly] = React.useState(panelHide.on)
      const [tabFilter, setTabFilter] = React.useState('')
      const [cat, setCat] = React.useState(() => { const s = lsRead(); return s && typeof s.cat === 'string' ? s.cat : 'ai' })
      const [activeByCat, setActiveByCat] = React.useState(() => { const s = lsRead(); return (s && s.activeByCat && typeof s.activeByCat === 'object') ? s.activeByCat : {} })
      const [catOverrides, setCatOverrides] = React.useState(() => { const s = catsRead(); return (s && s.overrides && typeof s.overrides === 'object') ? s.overrides : {} })
      const catOf = (id) => catOverrides[id] || DEFAULT_CAT[id] || 'dev'
      const [collapsedCats, setCollapsedCats] = React.useState(() => { const s = catsRead(); return (s && s.collapsed && typeof s.collapsed === 'object') ? s.collapsed : {} })
      const [dragId, setDragId] = React.useState(null)
      const schemeOf = (snap) => {
        const c = snap && snap.active && snap.active.colorScheme
        if (c === 'dark' || c === 'light') return c
        const top = snap && snap.colorScheme
        return (top === 'dark' || top === 'light') ? top : null
      }
      const [themeScheme, setThemeScheme] = React.useState(() => {
        try { return (themeSvc && schemeOf(themeSvc.getTheme())) || 'dark' } catch (e) { return 'dark' }
      })
      React.useEffect(() => {
        if (!themeSvc) return undefined
        const off = ctx.on('theme/change', (snap) => {
          try { const c = schemeOf(snap); if (c) setThemeScheme(c) } catch (e) {}
        })
        return typeof off === 'function' ? off : undefined
      }, [])
      const toggleTheme = () => {
        if (!themeSvc) return
        try {
          const cur = schemeOf(themeSvc.getTheme()) || themeScheme
          themeSvc.setTheme(cur === 'dark' ? 'light' : 'dark')
        } catch (e) {}
      }

      const PIP_ENABLED = false
      const pipRef = React.useRef(null) // { win, mo, syncTimer, themeOff, enlarged, baseW, baseH } | null
      const [pipOn, setPipOn] = React.useState(false)
      const [mainHidden, setMainHidden] = React.useState(false)
      const pipSupported = PIP_ENABLED && typeof window !== 'undefined' && Boolean(window.documentPictureInPicture)
      const closePip = () => {
        const cur = pipRef.current
        pipRef.current = null
        setPipOn(false)
        setMainHidden(false)
        if (!cur) return
        try { if (cur.mo) cur.mo.disconnect() } catch (e) {}
        try { if (cur.syncTimer) clearTimeout(cur.syncTimer) } catch (e) {}
        try { if (typeof cur.themeOff === 'function') cur.themeOff() } catch (e) {}
        try { cur.win.close() } catch (e) {}
      }
      React.useEffect(() => {
        if (isOpen && mainHidden) setMainHidden(false)
        if (!isOpen && pipRef.current) closePip()
      }, [isOpen])
      React.useEffect(() => () => {
        const cur = pipRef.current
        pipRef.current = null
        if (!cur) return
        try { if (cur.mo) cur.mo.disconnect() } catch (e) {}
        try { if (cur.syncTimer) clearTimeout(cur.syncTimer) } catch (e) {}
        try { cur.win.close() } catch (e) {}
      }, [])

      const pathOf = (el, root) => {
        const p = []
        let n = el
        while (n && n !== root) {
          const parent = n.parentElement
          if (!parent) return null
          p.unshift(Array.prototype.indexOf.call(parent.children, n))
          n = parent
        }
        return n === root ? p : null
      }
      const byPath = (root, path) => {
        let n = root
        for (const i of path) {
          if (!n || !n.children || i >= n.children.length) return null
          n = n.children[i]
        }
        return n
      }

      const openPip = async () => {
        if (pipRef.current) { closePip(); return }
        if (!pipSupported) return
        const src0 = drawerRef.current
        if (!src0) return
        try {
          const win = await window.documentPictureInPicture.requestWindow({ width: Math.max(560, width || 520), height: Math.round((window.screen ? window.screen.availHeight : 900) * 0.8) })
          for (const sheet of document.styleSheets) {
            try {
              if (sheet.href) { const l = win.document.createElement('link'); l.rel = 'stylesheet'; l.href = sheet.href; win.document.head.appendChild(l) }
              else if (sheet.ownerNode) win.document.head.appendChild(sheet.ownerNode.cloneNode(true))
            } catch (e) {}
          }
          const syncTheme = () => {
            try {
              const dark = document.body.hasAttribute('data-ds-dark-theme')
              win.document.body.toggleAttribute('data-ds-dark-theme', dark)
              win.document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
            } catch (e) {}
          }
          syncTheme()
          win.document.title = RT.displayName + ' · Picture in Picture'
          win.document.body.style.margin = '0'
          const rootEl = win.document.createElement('div')
          rootEl.className = 'jr-pip-root'
          rootEl.setAttribute('data-dsh-toolbox-root', RT.bundleId)
          const barEl = win.document.createElement('div')
          barEl.className = 'jr-pip-bar'
          const barTitle = win.document.createElement('span')
          barTitle.className = 'jr-pip-bar-title'
          barTitle.textContent = compactDisplayName + ' · Picture in Picture (mirrors the main window with live synchronized controls)'
          barTitle.title = fullDisplayName
          const btnMax = win.document.createElement('button')
          btnMax.className = 'jr-pip-bar-btn'
          btnMax.textContent = '⤢ Enlarge'
          btnMax.title = 'Enlargeto 72%×88% (Restore)'
          const btnBack = win.document.createElement('button')
          btnBack.className = 'jr-pip-bar-btn'
          btnBack.textContent = '✕ Return to main window'
          btnBack.title = 'Close Picture in Picture,Return to main windowdrawer'
          barEl.appendChild(barTitle)
          barEl.appendChild(btnMax)
          barEl.appendChild(btnBack)
          const mirrorEl = win.document.createElement('div')
          mirrorEl.className = 'jr-pip-mirror'
          rootEl.appendChild(barEl)
          rootEl.appendChild(mirrorEl)
          win.document.body.appendChild(rootEl)
          const entry = { win, mo: null, syncTimer: null, themeOff: null, enlarged: false, baseW: 0, baseH: 0 }
          pipRef.current = entry
          setPipOn(true)
          const resync = () => {
            if (pipRef.current !== entry) return
            const src = drawerRef.current
            if (!src) return
            const scrolls = []
            try {
              const ss = mirrorEl.querySelectorAll('.tb-pane-body, .tb-code, .fl-pre, .tb-desc, .jr-drawer-body, .tb-hrow')
              for (const s of ss) {
                const p = pathOf(s, mirrorEl)
                if (p) scrolls.push([p, s.scrollTop, s.scrollLeft])
              }
            } catch (e) {}
            let focusPath = null, selStart = null, selEnd = null
            try {
              const ae = win.document.activeElement
              if (ae && mirrorEl.contains(ae)) {
                focusPath = pathOf(ae, mirrorEl)
                if (typeof ae.selectionStart === 'number') { selStart = ae.selectionStart; selEnd = ae.selectionEnd }
              }
            } catch (e) {}
            const clone = src.cloneNode(true)
            clone.style.position = 'static'
            clone.style.left = 'auto'; clone.style.right = 'auto'; clone.style.top = 'auto'; clone.style.bottom = 'auto'
            clone.style.width = '100%'; clone.style.height = '100%'
            clone.style.maxWidth = 'none'; clone.style.maxHeight = 'none'
            clone.style.animation = 'none'; clone.style.boxShadow = 'none'; clone.style.borderRadius = '0'; clone.style.border = 'none'
            clone.style.visibility = 'visible'; clone.style.pointerEvents = 'auto'
            mirrorEl.innerHTML = ''
            mirrorEl.appendChild(clone)
            try { for (const [p, st, sl] of scrolls) { const el = byPath(mirrorEl, p); if (el) { el.scrollTop = st; el.scrollLeft = sl } } } catch (e) {}
            if (focusPath) {
              try {
                const el = byPath(mirrorEl, focusPath)
                if (el && typeof el.focus === 'function') {
                  el.focus()
                  if (selStart != null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(selStart, selEnd) } catch (e2) {} }
                }
              } catch (e) {}
            }
          }
          resync()
          entry.mo = new MutationObserver(() => {
            if (entry.syncTimer) clearTimeout(entry.syncTimer)
            entry.syncTimer = setTimeout(() => { entry.syncTimer = null; resync() }, 40)
          })
          entry.mo.observe(src0, { subtree: true, childList: true, attributes: true, characterData: true })
          const relay = (e) => {
            const t = e.target
            if (!t || !mirrorEl.contains(t)) return
            const p = pathOf(t, mirrorEl)
            const src = drawerRef.current
            if (!p || !src) return
            const main = byPath(src, p)
            if (!main) return
            if (e.type === 'click') {
              e.preventDefault()
              main.click()
            } else if (e.type === 'input') {
              try {
                const proto = main.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
                const desc = Object.getOwnPropertyDescriptor(proto, 'value')
                if (desc && desc.set) desc.set.call(main, t.value)
                else main.value = t.value
                main.dispatchEvent(new Event('input', { bubbles: true }))
              } catch (err) {}
            } else if (e.type === 'change') {
              try {
                if (main.tagName === 'SELECT') {
                  main.value = t.value
                  main.dispatchEvent(new Event('change', { bubbles: true }))
                } else if (main.type === 'checkbox' || main.type === 'radio') {
                  main.click()
                } else {
                  main.value = t.value
                  main.dispatchEvent(new Event('change', { bubbles: true }))
                }
              } catch (err) {}
            } else if (e.type === 'keydown') {
              try { main.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true })) } catch (err) {}
            }
          }
          for (const type of ['click', 'input', 'change', 'keydown']) mirrorEl.addEventListener(type, relay)
          btnBack.onclick = () => closePip()
          btnMax.onclick = () => {
            try {
              if (!entry.enlarged) {
                entry.baseW = win.outerWidth; entry.baseH = win.outerHeight
                const sw = window.screen ? window.screen.availWidth : 1600
                const sh = window.screen ? window.screen.availHeight : 900
                const w = Math.round(sw * 0.72), h = Math.round(sh * 0.88)
                win.resizeTo(w, h)
                win.moveTo(Math.round((sw - w) / 2), Math.round((sh - h) / 2))
                entry.enlarged = true
                btnMax.textContent = '⤡ Restore'
              } else {
                win.resizeTo(entry.baseW || 560, entry.baseH || 620)
                entry.enlarged = false
                btnMax.textContent = '⤢ Enlarge'
              }
            } catch (err) {}
          }
          if (themeSvc) entry.themeOff = ctx.on('theme/change', () => syncTheme())
          win.addEventListener('pagehide', () => {
            if (pipRef.current === entry) { pipRef.current = null; setPipOn(false); setMainHidden(false) }
            if (entry.syncTimer) { try { clearTimeout(entry.syncTimer) } catch (e) {} }
            if (entry.mo) { try { entry.mo.disconnect() } catch (e) {} }
            if (typeof entry.themeOff === 'function') { try { entry.themeOff() } catch (e) {} }
          })
        } catch (e) {}
      }
      const drawerRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const stateRef = React.useRef({})
      const htmlRef = React.useRef({})
      const htmlScrollRef = React.useRef(null)
      const seqRef = React.useRef({})
      const interactiveActionSeqRef = React.useRef({})
      const flowAnimRef = React.useRef({ scope: null, visible: 0, seen: new Set(), expires: new Map(), introEnds: new Map(), statuses: new Map(), outputStarts: new Map(), outputExpires: new Map(), timers: new Map() })
      const managingRef = React.useRef(false)
      managingRef.current = managing
      const activeRef = React.useRef(null)
      activeRef.current = active
      const openRef = React.useRef(isOpen)
      openRef.current = isOpen
      const retryCountRef = React.useRef({})
      const attemptedRef = React.useRef({})
      const flowOlderLoadingRef = React.useRef(false)
      const lastPanelActiveRef = React.useRef(null)
      const flowScrollByScopeRef = React.useRef(new Map())
      const flowScrollIntentRef = React.useRef(null)
      const flowSuppressHistoryAnimRef = React.useRef(false)
      const flowFollowStateBySessionRef = React.useRef(new Map())
      const flowHarnessNavTargetRef = React.useRef(null)
      const suppressFlowClickUntilRef = React.useRef(0)
      const sidebarSessionMenuRef = React.useRef(null)

      const exitFlowZen = async () => {
        const el = drawerRef.current
        try {
          if (typeof document !== 'undefined' && document.fullscreenElement === el && typeof document.exitFullscreen === 'function') await document.exitFullscreen()
        } catch (e) {}
        setFlowZen(false)
      }

      const toggleFlowZen = async () => {
        if (flowZen) { await exitFlowZen(); return }
        const el = drawerRef.current
        setFlowZen(true)
        if (!el || typeof el.requestFullscreen !== 'function') return
        try { await el.requestFullscreen() }
        catch (e) { setError('The browser denied native fullscreen; switched to viewport Zen mode') }
      }

      React.useEffect(() => { lsWrite({ dockMode, active, activeByCat }) }, [dockMode, active, activeByCat])

      React.useEffect(() => {
        if (RT.bundleId !== 'flowglass-en') return undefined
        const list = sessionsClient && sessionsClient.list
        if (!list || typeof list.getSnapshot !== 'function') return undefined
        const sync = () => setServiceSessionsSnapshot(readSessionsSnapshot())
        sync()
        if (typeof list.subscribe !== 'function') return undefined
        const off = list.subscribe(sync)
        return typeof off === 'function' ? off : undefined
      }, [])

      React.useEffect(() => {
        if (RT.bundleId === 'flowglass-en' || embedded || !isOpen || dockMode !== 'full') return undefined
        const col = typeof document !== 'undefined' ? document.querySelector('[class*="centerCol"]') : null
        if (!col) return undefined
        const w = width || 560
        const prev = col.style.marginRight
        col.style.marginRight = w + 'px'
        return () => { col.style.marginRight = prev }
      }, [embedded, isOpen, dockMode, width])

      React.useEffect(() => {
        if (!panelRef.current) return
        const flowIntent = flowScrollIntentRef.current
        const flow = panelRef.current.querySelector('[data-flow][data-flow-scope]')
        if (flowIntent && flow) {
          flowScrollIntentRef.current = null
          htmlScrollRef.current = null
          const body = flow.querySelector('.tb-pane-body')
          if (body) {
            const scope = flow.getAttribute('data-flow-scope') || ''
            if (flowIntent === 'back' && flowScrollByScopeRef.current.has(scope)) {
              body.scrollTop = flowScrollByScopeRef.current.get(scope)
            } else {
              body.scrollTop = 0
            }
          }
          return
        }
        const defaultBottom = panelRef.current.querySelector('[data-scroll-default="bottom"]')
        if (defaultBottom) {
          try { defaultBottom.scrollTop = defaultBottom.scrollHeight } catch (e) {}
          htmlScrollRef.current = null
          return
        }
        const saved = htmlScrollRef.current
        htmlScrollRef.current = null
        if (saved && saved.tool === activeRef.current) {
          try {
            const scrollers = panelRef.current.querySelectorAll('.tb-pane-body, .tb-code, .fl-pre, .tb-desc')
            scrollers.forEach((s, i) => { if (i < saved.scrolls.length) s.scrollTop = saved.scrolls[i] })
          } catch (e) {}
          return
        }
        try {
          panelRef.current.querySelectorAll('.tb-pane-body.tb-pane-col').forEach((s) => { s.scrollTop = s.scrollHeight })
        } catch (e) {}
      }, [html])

      function onFlowRailResizeDown(e) {
        if (active !== 'flow' || e.button !== 0) return
        const t = e.target
        const handle = t && typeof t.closest === 'function' ? t.closest('.fl-rail-resize') : null
        if (!handle) return
        const rail = handle.closest('.fl-rail')
        const pane = rail && rail.closest('.tb-pane')
        if (!rail || !pane) return
        e.preventDefault()
        e.stopPropagation()
        const startW = rail.getBoundingClientRect().width
        const startX = e.clientX
        const pointerId = e.pointerId
        const maxW = Math.max(320, Math.round(pane.getBoundingClientRect().width * 0.85))
        let lastW = Math.round(startW)
        rail.classList.add('fl-rail-dragging')
        try { handle.setPointerCapture(pointerId) } catch (err) {}
        try { document.body.style.userSelect = 'none' } catch (err) {}
        const onMove = (ev) => {
          if (ev.pointerId !== pointerId) return
          lastW = Math.round(Math.min(maxW, Math.max(240, startW + (startX - ev.clientX))))
          rail.style.setProperty('--fl-rail-w', lastW + 'px')
        }
        const onUp = (ev) => {
          if (ev.pointerId !== pointerId) return
          rail.classList.remove('fl-rail-dragging')
          try { handle.releasePointerCapture(pointerId) } catch (err) {}
          try { document.body.style.userSelect = '' } catch (err) {}
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.removeEventListener('pointercancel', onUp)
          appearanceWrite({ railW: lastW })
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', onUp)
      }

      React.useEffect(() => {
        if (!isOpen || managing) { setShowJumpLatest(false); return undefined }
        const root = panelRef.current
        if (!root) { setShowJumpLatest(false); return undefined }
        const primary = () => root.querySelector('.tb-pane-body')
        const update = (body) => {
          if (!body) { setShowJumpLatest(false); return }
          const away = body.classList.contains('tb-pane-col')
            ? (body.scrollHeight - body.scrollTop - body.clientHeight > 40)
            : (Math.abs(body.scrollTop) > 40)
          setShowJumpLatest(away)
        }
        const onScroll = (e) => {
          const body = primary()
          if (!body || e.target !== body) return
          update(body)
        }
        update(primary())
        root.addEventListener('scroll', onScroll, true)
        return () => { try { root.removeEventListener('scroll', onScroll, true) } catch (e) {} }
      }, [isOpen, managing, active, html])

      const jumpToLatest = () => {
        const body = panelRef.current && panelRef.current.querySelector('.tb-pane-body')
        if (!body) return
        const top = body.classList.contains('tb-pane-col') ? body.scrollHeight : 0
        try { body.scrollTo({ top, behavior: 'smooth' }) } catch (e) { body.scrollTop = top }
        setShowJumpLatest(false)
      }

      React.useEffect(() => {
        const box = panelRef.current
        const flow = box && box.querySelector('[data-flow][data-flow-scope]')
        const store = flowAnimRef.current
        const clearStore = () => {
          for (const timer of store.timers.values()) { try { clearTimeout(timer) } catch (e) {} }
          store.timers.clear()
          store.expires.clear()
          store.introEnds.clear()
          store.statuses.clear()
          store.outputStarts.clear()
          store.outputExpires.clear()
          store.seen.clear()
        }
        if (active !== 'flow' || !flow) {
          if (store.scope != null) clearStore()
          store.scope = null
          return
        }
        const scope = flow.getAttribute('data-flow-scope') || ''
        const visible = Math.max(0, Number(flow.getAttribute('data-flow-visible')) || 0)
        const historyExpanded = store.scope === scope && visible > (store.visible || 0)
        const cards = [...flow.querySelectorAll('.fl-wp[data-flow-card]')]
        const mainSelector = '.fl-node[data-flow-main-card][data-flow-role="user"],.fl-node[data-flow-main-card][data-flow-role="ai"]'
        const mainCards = [...flow.querySelectorAll(mainSelector)]
        if (store.scope !== scope) {
          clearStore()
          store.scope = scope
          for (const card of cards) {
            const key = card.getAttribute('data-flow-card') || ''
            store.seen.add(key)
            if (key) store.statuses.set(key, card.getAttribute('data-flow-status') || 'pending')
          }
          let latestUserKey = ''
          let latestUserSeq = -Infinity
          for (const card of mainCards) {
            const rawKey = card.getAttribute('data-flow-main-card') || ''
            const seq = Number(rawKey)
            if (card.getAttribute('data-flow-role') === 'user' && Number.isFinite(seq) && seq > latestUserSeq) {
              latestUserSeq = seq
              latestUserKey = rawKey
            }
          }
          for (const card of mainCards) {
            const rawKey = card.getAttribute('data-flow-main-card') || ''
            if (rawKey !== latestUserKey) store.seen.add('main:' + rawKey)
          }
        }
        store.visible = visible
        if (flowSuppressHistoryAnimRef.current || historyExpanded) {
          flowSuppressHistoryAnimRef.current = false
          for (const card of cards) {
            const key = card.getAttribute('data-flow-card') || ''
            if (key) {
              store.seen.add(key)
              store.statuses.set(key, card.getAttribute('data-flow-status') || 'pending')
            }
          }
          for (const card of mainCards) {
            const key = card.getAttribute('data-flow-main-card') || ''
            if (key) store.seen.add('main:' + key)
          }
        }
        const now = Date.now()
        for (const card of cards) {
          const key = card.getAttribute('data-flow-card') || ''
          if (!key) continue
          const status = card.getAttribute('data-flow-status') || 'pending'
          const isNew = !store.seen.has(key)
          const previousStatus = store.statuses.get(key)
          if (isNew) {
            store.seen.add(key)
            store.introEnds.set(key, now + 1500)
          }
          const introEnd = store.introEnds.get(key) || 0
          if ((isNew && status !== 'pending') || (previousStatus === 'pending' && status !== 'pending')) {
            const outputStart = Math.max(now, introEnd)
            store.outputStarts.set(key, outputStart)
            store.outputExpires.set(key, outputStart + 500)
          }
          store.statuses.set(key, status)

          if (introEnd > now) {
            card.style.setProperty('--fl-min-delay', '-' + Math.max(0, 1500 - (introEnd - now)) + 'ms')
            card.classList.add('fl-min-anim')
          }
          const introTimerKey = 'intro:' + key
          if (introEnd > now && !store.timers.has(introTimerKey)) {
            const timer = setTimeout(() => {
              store.timers.delete(introTimerKey)
              store.introEnds.delete(key)
              const currentFlow = panelRef.current && panelRef.current.querySelector('[data-flow][data-flow-scope]')
              if (!currentFlow || (currentFlow.getAttribute('data-flow-scope') || '') !== scope) return
              for (const current of currentFlow.querySelectorAll('.fl-wp[data-flow-card]')) {
                if ((current.getAttribute('data-flow-card') || '') === key) {
                  current.classList.remove('fl-min-anim')
                  current.style.removeProperty('--fl-min-delay')
                }
              }
            }, Math.max(0, introEnd - now))
            store.timers.set(introTimerKey, timer)
          }

          const outputStart = store.outputStarts.get(key) || 0
          const outputEnd = store.outputExpires.get(key) || 0
          if (outputEnd > now) {
            const outputDelay = outputStart > now ? outputStart - now : -(now - outputStart)
            card.style.setProperty('--fl-output-delay', outputDelay + 'ms')
            card.classList.add('fl-output-anim')
          }
          const outputTimerKey = 'output:' + key
          if (outputEnd > now && !store.timers.has(outputTimerKey)) {
            const timer = setTimeout(() => {
              store.timers.delete(outputTimerKey)
              store.outputStarts.delete(key)
              store.outputExpires.delete(key)
              const currentFlow = panelRef.current && panelRef.current.querySelector('[data-flow][data-flow-scope]')
              if (!currentFlow || (currentFlow.getAttribute('data-flow-scope') || '') !== scope) return
              for (const current of currentFlow.querySelectorAll('.fl-wp[data-flow-card]')) {
                if ((current.getAttribute('data-flow-card') || '') === key) {
                  current.classList.remove('fl-output-anim')
                  current.style.removeProperty('--fl-output-delay')
                }
              }
            }, Math.max(0, outputEnd - now))
            store.timers.set(outputTimerKey, timer)
          }
        }
        for (const card of mainCards) {
          const rawKey = card.getAttribute('data-flow-main-card') || ''
          if (!rawKey) continue
          const key = 'main:' + rawKey
          if (!store.seen.has(key)) {
            store.seen.add(key)
            store.expires.set(key, now + 1000)
          }
          const expires = store.expires.get(key) || 0
          if (expires <= now) continue
          card.style.setProperty('--fl-main-delay', '-' + Math.max(0, 1000 - (expires - now)) + 'ms')
          card.classList.add('fl-main-min-anim')
          if (!store.timers.has(key)) {
            const timer = setTimeout(() => {
              store.timers.delete(key)
              store.expires.delete(key)
              const currentFlow = panelRef.current && panelRef.current.querySelector('[data-flow][data-flow-scope]')
              if (!currentFlow || (currentFlow.getAttribute('data-flow-scope') || '') !== scope) return
              for (const current of currentFlow.querySelectorAll(mainSelector)) {
                if ((current.getAttribute('data-flow-main-card') || '') === rawKey) {
                  current.classList.remove('fl-main-min-anim')
                  current.style.removeProperty('--fl-main-delay')
                }
              }
            }, Math.max(0, expires - now))
            store.timers.set(key, timer)
          }
        }
      }, [active, html])

      React.useEffect(() => () => {
        const store = flowAnimRef.current
        for (const timer of store.timers.values()) { try { clearTimeout(timer) } catch (e) {} }
        store.timers.clear()
      }, [])

      React.useEffect(() => {
        if (!isOpen || active !== 'flow') return undefined
        const updateTimers = () => {
          const root = panelRef.current
          if (!root) return
          const now = Date.now()
          for (const el of root.querySelectorAll('[data-flow-timer]')) {
            const started = Number(el.getAttribute('data-flow-timer'))
            if (!Number.isFinite(started)) continue
            const ms = Math.max(0, now - started)
            const shown = ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's'
            el.textContent = (el.getAttribute('data-flow-timer-prefix') || '') + shown
          }
        }
        updateTimers()
        const timer = setInterval(updateTimers, 250)
        return () => { try { clearInterval(timer) } catch (e) {} }
      }, [isOpen, active, html])

      // Upgrade controls before paint when an old resident Host returns the
      // pre-icon HTML contract. New Hosts already emit the same controls, so
      // this path is idempotent and only fills missing markup/attributes.
      React.useLayoutEffect(() => {
        if (!isOpen || active !== 'flow') return undefined
        const root = panelRef.current
        if (!root) return undefined
        for (const button of root.querySelectorAll('[data-flow-copy]')) {
          if (!button.querySelector('svg')) button.innerHTML = FLOW_COPY_ICON_HTML
          button.setAttribute('title', 'Copy content to clipboard')
          button.setAttribute('aria-label', 'Copy content to clipboard')
        }
        const target = root.querySelector('[data-flow-markdown-body]')
        const source = target && target.querySelector('[data-flow-markdown-source]')
        if (!target || !source) {
          flowMarkdownDisabledKeyRef.current = null
          return undefined
        }
        let key = target.getAttribute('data-flow-markdown-key') || ''
        if (!key) {
          const close = target.closest('.fl-rail') && target.closest('.fl-rail').querySelector('[data-action="fdetail"][data-seq]')
          key = close ? (close.getAttribute('data-seq') || '') : ''
          if (key) target.setAttribute('data-flow-markdown-key', key)
        }
        let previewButton = target.querySelector('[data-flow-markdown-preview]')
        if (!previewButton && key) {
          previewButton = document.createElement('button')
          previewButton.type = 'button'
          previewButton.className = 'fl-md-preview-btn'
          previewButton.setAttribute('data-flow-markdown-preview', '1')
          previewButton.setAttribute('data-flow-markdown-key', key)
          previewButton.setAttribute('title', 'Markdown preview')
          previewButton.setAttribute('aria-label', 'Markdown preview')
          previewButton.setAttribute('aria-pressed', 'false')
          previewButton.innerHTML = FLOW_PREVIEW_ICON_HTML
          const head = source.closest('.fl-sec') && source.closest('.fl-sec').querySelector('.fl-sec-head')
          const copy = head && head.querySelector('[data-flow-copy]')
          if (head) head.insertBefore(previewButton, copy || null)
        }
        if (key && !flowMarkdownPreviewKey && flowMarkdownDisabledKeyRef.current !== key) {
          setFlowMarkdownPreviewKey(key)
        }
        return undefined
      }, [isOpen, active, html, flowMarkdownPreviewKey])

      // Host HTML remains the default text view. Only an explicit preview click
      // enables the official Markdown renderer. useLayoutEffect reconnects the
      // portal before paint after Host HTML replacement, avoiding text flashes.
      React.useLayoutEffect(() => {
        if (!flowMarkdownPreviewKey || !flowMarkdownText || !flowCreatePortal || !isOpen || active !== 'flow') {
          setFlowMarkdownPortal((current) => current === null ? current : null)
          return undefined
        }
        const root = panelRef.current
        const target = root && root.querySelector('[data-flow-markdown-body]')
        const source = target && target.querySelector('[data-flow-markdown-source]')
        const key = target && target.getAttribute('data-flow-markdown-key')
        if (!target || !source || key !== flowMarkdownPreviewKey) {
          setFlowMarkdownPreviewKey(null)
          setFlowMarkdownPortal((current) => current === null ? current : null)
          return undefined
        }
        target.setAttribute('data-flow-markdown-enhanced', '1')
        const previewButton = target.querySelector('[data-flow-markdown-preview]')
        if (previewButton) previewButton.setAttribute('aria-pressed', 'true')
        const mount = source.closest('.fl-sec') || target
        const text = String(source.textContent || '')
        const streaming = target.getAttribute('data-flow-markdown-streaming') === '1'
        setFlowMarkdownPortal((current) => current
          && current.target === target && current.mount === mount && current.text === text && current.streaming === streaming
          ? current
          : { target, mount, text, streaming })
        return () => {
          try { target.removeAttribute('data-flow-markdown-enhanced') } catch (e) {}
          try { if (previewButton) previewButton.setAttribute('aria-pressed', 'false') } catch (e) {}
        }
      }, [isOpen, active, html, flowMarkdownPreviewKey])

      const readLsSession = () => {
        try {
          if (typeof localStorage === 'undefined') return undefined
          const raw = localStorage.getItem('dsh.sessions.current')
          if (!raw) return undefined
          const p = JSON.parse(raw)
          return p && typeof p.sessionId === 'string' && p.sessionId ? p.sessionId : undefined
        } catch (e) { return undefined }
      }
      const [lsSession, setLsSession] = React.useState(readLsSession)
      React.useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onChanged = () => setLsSession(readLsSession())
        window.addEventListener(SESSION_EVENT, onChanged)
        return () => { try { window.removeEventListener(SESSION_EVENT, onChanged) } catch (e) {} }
      }, [])
      React.useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onFlowSettingsChanged = () => {
          if (activeRef.current !== 'flow' || !openRef.current || typeof loadPanelRef.current !== 'function') return
          loadPanelRef.current('flow', '__refresh', null, { silent: true })
        }
        window.addEventListener(FLOW_SETTINGS_EVENT, onFlowSettingsChanged)
        return () => { try { window.removeEventListener(FLOW_SETTINGS_EVENT, onFlowSettingsChanged) } catch (e) {} }
      }, [])
      const hookSession = props.useSessions((s) => (s && s.current ? String(s.current) : undefined))
      const hookFlowSessionIds = props.useSessions((s) => (s ? s.ids : undefined))
      const hookFlowSessionsById = props.useSessions((s) => (s ? s.byId : undefined))
      const useWorkspacesHook = typeof props.useWorkspaces === 'function' ? props.useWorkspaces : () => undefined
      const hookWorkspaceItems = useWorkspacesHook((s) => (s && Array.isArray(s.items) ? s.items : undefined))
      const hookArchivedSessionIds = useWorkspacesHook((s) => (s && Array.isArray(s.archivedSessionIds) ? s.archivedSessionIds : undefined))
      let fallbackArchivedSessionIds = []
      if (!hookArchivedSessionIds && workspacesClient && workspacesClient.list && typeof workspacesClient.list.getSnapshot === 'function') {
        try {
          const snapshot = workspacesClient.list.getSnapshot()
          if (snapshot && Array.isArray(snapshot.archivedSessionIds)) fallbackArchivedSessionIds = snapshot.archivedSessionIds
        } catch (e) {}
      }
      const archivedSessionIds = (hookArchivedSessionIds || fallbackArchivedSessionIds).map(String)
      const archivedSessionSet = new Set(archivedSessionIds)
      const rawFlowSessionIds = hookFlowSessionIds != null
        ? hookFlowSessionIds
        : (RT.bundleId === 'flowglass-en' && serviceSessionsSnapshot ? serviceSessionsSnapshot.ids : undefined)
      const rawFlowSessionsById = hookFlowSessionsById != null
        ? hookFlowSessionsById
        : (RT.bundleId === 'flowglass-en' && serviceSessionsSnapshot ? serviceSessionsSnapshot.byId : undefined)
      const allFlowSessionIds = Array.isArray(rawFlowSessionIds)
        ? rawFlowSessionIds
        : (rawFlowSessionIds && typeof rawFlowSessionIds[Symbol.iterator] === 'function'
            ? Array.from(rawFlowSessionIds)
            : (rawFlowSessionsById && typeof rawFlowSessionsById === 'object'
                ? (rawFlowSessionsById instanceof Map ? [...rawFlowSessionsById.keys()] : Object.keys(rawFlowSessionsById))
                : []))
      const flowSessionIds = allFlowSessionIds.map(String).filter((id) => !archivedSessionSet.has(id))
      const flowSessionRow = (id) => rawFlowSessionsById instanceof Map
        ? rawFlowSessionsById.get(id)
        : (rawFlowSessionsById && typeof rawFlowSessionsById === 'object' ? rawFlowSessionsById[id] : undefined)
      const currentSessionId = props.sessionId || (hookSession || lsSession) || undefined
      const harnessSelectedSessionId = hookSession || lsSession || props.sessionId || undefined
      const [sessionCwd, setSessionCwd] = React.useState(undefined)
      React.useEffect(() => {
        let alive = true
        if (!currentSessionId) { setSessionCwd(undefined); return undefined }
        host.call(RT.rpc('session-info'), { session: currentSessionId })
          .then((r) => { if (alive && r && r.ok && typeof r.cwd === 'string') setSessionCwd(r.cwd) })
          .catch(() => {})
        return () => { alive = false }
      }, [currentSessionId])
      const hookCwd = props.useSessions((s) => {
        if (!s || !s.current) return undefined
        const row = s.byId && s.byId[s.current]
        return row && typeof row.cwd === 'string' && row.cwd ? row.cwd : undefined
      })
      const currentCwd = props.cwd || sessionCwd || hookCwd
      const zoomLogCwdRef = React.useRef(currentCwd || '')
      if (currentCwd) zoomLogCwdRef.current = currentCwd
      const flowZoomLogStorageKey = () => {
        const cwdKey = String(zoomLogCwdRef.current || 'default').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        return RT.storageKey('flow.zoom-runs.' + cwdKey)
      }
      const readFlowZoomLog = () => {
        try {
          const raw = localStorage.getItem(flowZoomLogStorageKey())
          if (!raw) return { open: false, activeId: '', runs: [] }
          const parsed = JSON.parse(raw)
          if (!parsed || typeof parsed !== 'object') return { open: false, activeId: '', runs: [] }
          if (!archivedSessionSet.size || !Array.isArray(parsed.runs)) return parsed
          const runs = parsed.runs.map((run) => {
            if (!run || !Array.isArray(run.rounds)) return null
            const rounds = run.rounds.map((round) => {
              if (!round || !Array.isArray(round.sids)) return null
              const keep = round.sids.map((sid, i) => ({ sid: String(sid), i })).filter((item) => !archivedSessionSet.has(item.sid))
              return {
                ...round,
                sourceSids: Array.isArray(round.sourceSids) ? round.sourceSids.map(String).filter((sid) => !archivedSessionSet.has(sid)) : [],
                sids: keep.map((item) => item.sid),
                routes: keep.map((item) => (Array.isArray(round.routes) ? round.routes[item.i] : '') || ''),
                efforts: keep.map((item) => (Array.isArray(round.efforts) ? round.efforts[item.i] : '') || ''),
              }
            }).filter((round) => round && round.sids.length)
            const latest = rounds[rounds.length - 1]
            return latest ? { ...run, rounds, sids: latest.sids, routes: latest.routes, efforts: latest.efforts } : null
          }).filter(Boolean)
          const active = runs.find((run) => run.id === parsed.activeId) || runs[runs.length - 1]
          const round = active && (active.rounds.find((item) => item.id === parsed.roundId) || active.rounds[active.rounds.length - 1])
          return { ...parsed, runs, activeId: active ? active.id : '', roundId: round ? round.id : '' }
        } catch (e) { return { open: false, activeId: '', runs: [] } }
      }
      const writeFlowZoomLog = (state) => {
        try {
          const prevRaw = (() => {
            try {
              const p = JSON.parse(localStorage.getItem(flowZoomLogStorageKey()) || 'null')
              return p && Array.isArray(p.runs) ? p.runs : []
            } catch (e) { return [] }
          })()
          const merged = prevRaw.slice()
          const indexById = new Map()
          merged.forEach((run, i) => { if (run && typeof run.id === 'string') indexById.set(run.id, i) })
          const stateRuns = state && Array.isArray(state.zoomRuns) ? state.zoomRuns : []
          for (const run of stateRuns) {
            if (!run || typeof run.id !== 'string') continue
            const at = indexById.get(run.id)
            if (typeof at === 'number') merged[at] = run
            else { indexById.set(run.id, merged.length); merged.push(run) }
          }
          localStorage.setItem(flowZoomLogStorageKey(), JSON.stringify({
            open: !!(state && state.zoom),
            activeId: state && typeof state.zoomRunId === 'string' ? state.zoomRunId : '',
            roundId: state && typeof state.zoomRoundId === 'string' ? state.zoomRoundId : '',
            runs: merged.slice(-20),
            view: state && (state.zoomView === 'detail' || state.zoomView === 'map') ? state.zoomView : 'compact',
            mode: state && state.zoomMode === 'near' ? 'near' : 'panorama',
            focusSid: state && typeof state.zoomFocusSid === 'string' ? state.zoomFocusSid : '',
            lastFocusSid: state && typeof state.zoomLastFocusSid === 'string' ? state.zoomLastFocusSid : '',
          }))
        } catch (e) {}
      }
      const cwdRef = React.useRef(currentCwd)
      cwdRef.current = currentCwd
      const handledCwdRef = React.useRef(currentCwd || '')
      const handledSessionRef = React.useRef(currentSessionId || '')

      const LIVE_TEXT_CAP = 8000
      const liveOverlayRef = React.useRef(null)
      const [liveRevision, setLiveRevision] = React.useState(0)
      const liveSettledRef = React.useRef([])
      React.useEffect(() => {
        liveOverlayRef.current = null
        liveSettledRef.current = []
        setLiveRevision(0)
        if (!sessionsClient || typeof sessionsClient.binding !== 'function' || !currentSessionId) return undefined
        let attempts = new Map()
        let initialized = false
        const appendCapped = (current, delta) => {
          const room = Math.max(0, LIVE_TEXT_CAP - current.length)
          return room === 0 ? current : current + String(delta).slice(0, room)
        }
        const acceptTransient = (entry, target) => {
          if (!entry || entry.type !== 'transient' || !entry.event) return
          const ev = entry.event
          if (ev.type !== 'assistant/live-chunk') return
          const d = ev.data || {}
          const id = String(d.attemptId == null ? '' : d.attemptId)
          if (!id) return
          let a = target.get(id)
          if (!a) {
            a = {
              attemptId: id,
              turn: typeof d.turn === 'number' ? d.turn : null,
              step: typeof d.step === 'number' ? d.step : null,
              firstSeq: ev.seq, firstAt: ev.time, lastAt: ev.time,
              text: '', reasoning: '', toolCall: false, finish: null,
            }
            target.set(id, a)
          }
          const chunk = d.chunk || {}
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            a.text = appendCapped(a.text, chunk.text)
          } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
            a.reasoning = appendCapped(a.reasoning, chunk.text)
          } else if (chunk.type === 'tool-call-delta') {
            a.toolCall = true
          } else if (chunk.type === 'finish' && chunk.reason) {
            const f = chunk.reason.failure || {}
            a.finish = {
              kind: String(chunk.reason.kind || ''),
              code: typeof f.code === 'string' ? f.code : '',
              message: typeof f.message === 'string' ? f.message : '',
            }
          }
          a.lastAt = ev.time
        }
        const publishWindow = (win) => {
          liveOverlayRef.current = {
            sessionId: currentSessionId,
            revision: win && typeof win.revision === 'number' ? win.revision : 0,
            attempts: [...attempts.values()],
            settled: liveSettledRef.current.slice(-8),
          }
          setLiveRevision((r) => r + 1)
        }
        const rebuildWindow = (win) => {
          const next = new Map()
          for (const entry of (win && Array.isArray(win.entries) && win.entries) || []) acceptTransient(entry, next)
          attempts = next
        }
        const foldWindow = (win) => {
          const change = win && win.change
          // First attachment must rebuild even when the source's latest change
          // was only an append; otherwise earlier chunks of an in-flight baseline
          // would be lost. Subsequent publications use the exact window delta.
          if (!initialized || !change || change.kind === 'replace') {
            rebuildWindow(win)
            initialized = true
          } else if (change.kind === 'append') {
            for (const entry of Array.isArray(change.entries) ? change.entries : []) acceptTransient(entry, attempts)
          } else if (change.kind === 'settle-assistant') {
            const id = String(change.attemptId == null ? '' : change.attemptId)
            const a = attempts.get(id)
            attempts.delete(id)
            // Only a durable settlement needs an occurrence bridge. An
            // abandonment has no replacement card and must not poison a later
            // attempt in the same turn/step.
            if (a && change.entry) {
              liveSettledRef.current.push({ attemptId: id, turn: a.turn, step: a.step, firstSeq: a.firstSeq })
              if (liveSettledRef.current.length > 24) liveSettledRef.current = liveSettledRef.current.slice(-24)
            }
          }
          // prepend carries durable history only, so the active attempt map is unchanged.
          publishWindow(win)
        }
        let off = null
        const attach = () => {
          let binding
          try { binding = sessionsClient.binding(currentSessionId) } catch (e) { binding = null }
          const src = binding && binding.eventSource
          if (!src || typeof src.getSnapshot !== 'function') return false
          foldWindow(src.getSnapshot())
          if (typeof src.subscribe === 'function') off = src.subscribe(() => foldWindow(src.getSnapshot()))
          return true
        }
        let retryTimer = null
        if (!attach()) {
          let tries = 0
          retryTimer = setInterval(() => {
            tries += 1
            if (off || attach() || tries > 20) { try { clearInterval(retryTimer) } catch (e) {} }
          }, 800)
        }
        return () => {
          try { if (off) off() } catch (e) {}
          try { if (retryTimer) clearInterval(retryTimer) } catch (e) {}
        }
      }, [currentSessionId, flowSessionIds.join('\u0001')])

      React.useEffect(() => {
        if (!liveRevision) return undefined
        const t = setTimeout(() => {
          const st = stateRef.current.flow
          if (activeRef.current !== 'flow' || !openRef.current || managingRef.current) return
          if (!st || st.live === false || st.settings === true) return
          if (zoomComposerBusy()) return
          if (typeof loadPanelRef.current === 'function') loadPanelRef.current('flow', '__refresh', null, { silent: true })
        }, 150)
        return () => { try { clearTimeout(t) } catch (e) {} }
      }, [liveRevision])

      React.useEffect(() => {
        if (!flowTargetSession || !flowSessionIds.includes(flowTargetSession)) setFlowTargetSession(currentSessionId || flowSessionIds[0] || '')
      }, [currentSessionId, flowSessionIds, flowTargetSession])

      React.useEffect(() => {
        const titleOf = (id) => {
          const row = flowSessionRow(id) || {}
          return String(row.displayTitle || row.title || '')
        }
        const sessionForActionLabel = (label) => {
          let name = ''
          let m = /^Session actions for (.+)$/u.exec(label)
          if (m) name = m[1]
          else { m = /^Session actions for (.+)$/u.exec(label); if (m) name = m[1] }
          if (!name) return ''
          const matches = flowSessionIds.filter((id) => titleOf(id) === name)
          if (matches.length === 1) return matches[0]
          if (currentSessionId && matches.includes(currentSessionId)) return currentSessionId
          return ''
        }
        const activeRound = () => {
          const log = readFlowZoomLog()
          const runs = Array.isArray(log.runs) ? log.runs : []
          const run = runs.find((item) => item && item.id === log.activeId) || runs[runs.length - 1]
          if (!run || !Array.isArray(run.rounds) || !run.rounds.length) return null
          const round = run.rounds.find((item) => item && item.id === log.roundId) || run.rounds[run.rounds.length - 1]
          return round && Array.isArray(round.sids) ? round : null
        }
        const onPointerDown = (e) => {
          const button = e.target && e.target.closest ? e.target.closest('button[aria-label]') : null
          if (!button) return
          const sid = sessionForActionLabel(button.getAttribute('aria-label') || '')
          if (sid) sidebarSessionMenuRef.current = { sid, anchor: button }
        }
        const enhance = () => {
          const pending = sidebarSessionMenuRef.current
          if (!pending || !document.body) return
          for (const menu of document.body.querySelectorAll('[role="menu"]')) {
            if (menu.querySelector('[data-flow-sidebar-join]')) continue
            const items = [...menu.querySelectorAll('[role="menuitem"]')]
            const labels = items.map((item) => String(item.textContent || '').trim())
            const isSessionMenu = labels.some((x) => x === 'Rename')
              && labels.some((x) => x === 'Fork session')
              && labels.some((x) => x === 'Archive session')
            if (!isSessionMenu) continue
            const template = items[items.length - 1]
            const wrap = template && template.parentElement
            const viewport = wrap && wrap.parentElement
            if (!wrap || !viewport) continue
            const clone = wrap.cloneNode(true)
            const button = clone.querySelector('[role="menuitem"]')
            if (!button) continue
            button.setAttribute('data-flow-sidebar-join', '1')
            button.removeAttribute('aria-haspopup'); button.removeAttribute('aria-expanded')
            const spans = button.querySelectorAll('span')
            if (spans[0]) spans[0].textContent = '＋'
            const round = activeRound()
            let label = 'Add to current concurrent branches'
            let disabled = false
            if (!round) { label = 'No active concurrent run'; disabled = true }
            else if (round.sids.includes(pending.sid)) { label = 'Already in the current concurrent run'; disabled = true }
            else if (round.sids.length >= 4) { label = 'The current concurrent run is full'; disabled = true }
            else {
              const member = flowSessionRow(round.sids[0]) || {}
              const candidate = flowSessionRow(pending.sid) || {}
              if (member.cwd && candidate.cwd && member.cwd !== candidate.cwd) { label = 'Not in the current workspace'; disabled = true }
            }
            if (spans[1]) spans[1].textContent = label
            else button.textContent = label
            button.disabled = disabled
            button.addEventListener('click', (event) => {
              event.preventDefault(); event.stopPropagation()
              if (button.disabled || typeof loadPanelRef.current !== 'function') return
              Promise.resolve(loadPanelRef.current('flow', 'fzoom-run-add', { dataset: { sid: pending.sid } }, { silent: true }))
                .then(() => { setFlowUiNotice('Added to the current concurrent run:' + titleOf(pending.sid)); try { pending.anchor.click() } catch (err) {} })
                .catch((err) => { setError('Failed to join the current concurrent run: ' + String((err && err.message) || err)) })
            })
            viewport.appendChild(clone)
          }
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        const observer = new MutationObserver(() => { Promise.resolve().then(enhance) })
        if (document.body) observer.observe(document.body, { childList: true, subtree: true })
        return () => { document.removeEventListener('pointerdown', onPointerDown, true); observer.disconnect() }
      }, [currentSessionId, flowSessionIds.join('\u0001')])

      React.useEffect(() => {
        setFlowSelectedSeqs([])
        setFlowBringPopup(false)
        setFlowTreeOpen({})
        setFlowUiNotice('')
      }, [currentSessionId])

      React.useEffect(() => {
        if (active === 'flow') return
        exitFlowZen()
        setFlowSelectedSeqs([])
        setFlowBringPopup(false)
        setFlowTreeOpen({})
        setFlowUiNotice('')
      }, [active])

      React.useEffect(() => {
        if (!flowZen || typeof window === 'undefined') return undefined
        const onKey = (e) => { if (e.key === 'Escape' && (typeof document === 'undefined' || !document.fullscreenElement)) setFlowZen(false) }
        window.addEventListener('keydown', onKey)
        return () => { try { window.removeEventListener('keydown', onKey) } catch (e) {} }
      }, [flowZen])

      React.useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const onFullscreen = () => {
          const el = drawerRef.current
          if (document.fullscreenElement === el) setFlowZen(true)
          else if (!document.fullscreenElement) setFlowZen(false)
        }
        document.addEventListener('fullscreenchange', onFullscreen)
        return () => {
          try { document.removeEventListener('fullscreenchange', onFullscreen) } catch (e) {}
          const el = drawerRef.current
          try { if (document.fullscreenElement === el && document.exitFullscreen) document.exitFullscreen().catch(() => {}) } catch (e) {}
        }
      }, [])

      const flowScope = () => {
        const flow = panelRef.current && panelRef.current.querySelector('[data-flow][data-flow-scope]')
        return flow ? (flow.getAttribute('data-flow-scope') || '') : ''
      }

      const flowBoardEl = () => {
        const el = panelRef.current && panelRef.current.querySelector('[data-flow][data-flow-board]')
        return el || null
      }
      const flowZoomHostEl = () => {
        const board = flowBoardEl()
        if (board) return board
        const root = panelRef.current
        const prompt = root && root.querySelector('[data-zoom-prompt]')
        return prompt && typeof prompt.closest === 'function' ? prompt.closest('[data-flow]') : null
      }
      const zoomComposerText = () => {
        const b = flowZoomHostEl()
        const input = b && b.querySelector('[data-zoom-prompt]')
        return input ? String(input.value || '') : String(zoomPromptRef.current || '')
      }
      const zoomComposerBusy = () => Boolean(flowZoomHostEl() && zoomComposerText().trim())

      const setFlowZoomLevel = (value) => {
        const levels = [60, 75, 90, 100, 110, 125, 150]
        const nearest = levels.reduce((best, n) => Math.abs(n - value) < Math.abs(best - value) ? n : best, 100)
        setFlowZoom(nearest)
        try { localStorage.setItem(RT.storageKey('flow.zoom'), String(nearest)) } catch (e) {}
      }

      const stepFlowZoom = (direction) => {
        const levels = [60, 75, 90, 100, 110, 125, 150]
        const at = Math.max(0, levels.indexOf(flowZoom))
        setFlowZoomLevel(levels[Math.max(0, Math.min(levels.length - 1, at + direction))])
      }

      const branchFlowAt = async (seq, sourceSessionId) => {
        const source = sourceSessionId || flowScope()
        if (!source || !Number.isFinite(Number(seq))) return
        if (!sessionsClient || typeof sessionsClient.fork !== 'function') { setError('This Harness version does not support session branching'); return }
        setFlowUiBusy(true); setFlowUiNotice('Creating a branch session…')
        try {
          const childId = await sessionsClient.fork({ sessionId: source, atSeq: Number(seq), increaseTitle: true })
          await navigateHarnessSession({ sessionId: childId })
          const reopen = () => { try { if (nativeOpenTab) nativeOpenTab() } catch (e) {} }
          try { ctx.timeout(reopen, 0); ctx.timeout(reopen, 180) } catch (e) {}
          setFlowUiNotice('Branch session created')
          setFlowSelectedSeqs([])
          setFlowBringPopup(false)
          setFlowTreeOpen({})
        } catch (e) { setError('branchfailed: ' + String((e && e.message) || e)) }
        finally { setFlowUiBusy(false) }
      }

      const fetchSelectedFlowContext = async () => {
        if (!flowSelectedSeqs.length) throw new Error('Please first select')
        const res = await host.call(RT.rpc('panel'), {
          tool: 'flow', action: 'fcontext',
          fields: { __el: { seqs: flowSelectedSeqs.join(',') } },
          state: stateRef.current.flow || null,
          root: currentCwd || undefined,
          session: currentSessionId || undefined,
        })
        if (!res || !res.ok || !res.flowContext || !res.flowContext.text) throw new Error((res && res.error) || 'Unable to readselectedcontent')
        return res.flowContext
      }

      const withSessionProvideInfo = async (sessionId, operation) => {
        const uiSession = ctx.get('uiSession')
        if (!uiSession || !uiSession.adapter) {
          throw new Error('This Harness version does not support writing drafts across sessions (the uiSession binding service is missing)')
        }
        if (sessionsClient && typeof sessionsClient.using === 'function'
          && typeof uiSession.adapter.bindingSource === 'function') {
          return sessionsClient.using(sessionId, { source: 'controllerOperation' }, (reference) => {
            const source = uiSession.adapter.bindingSource(reference)
            const binding = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : undefined
            if (!binding || binding.key == null) throw new Error('The target session UI binding is unavailable')
            return operation({ props: binding.props, hooks: binding.hooks })
          })
        }
        if (typeof uiSession.adapter.resolve !== 'function') {
          throw new Error('This Harness version does not support writing drafts across sessions (the uiSession resolver is missing)')
        }
        for (let i = 0; i < 3; i++) {
          const binding = uiSession.adapter.resolve(sessionId)
          if (binding) return operation({ props: binding.props, hooks: binding.hooks })
          await new Promise((resolve) => setTimeout(resolve, 120))
        }
        throw new Error('The target session UI binding is unavailable')
      }

      const putFlowContextIntoDraft = async (sessionId, text, append) => {
        await withSessionProvideInfo(sessionId, (info) => {
          const actions = info && info.props && info.props.inputActions
          const input = info && info.hooks && info.hooks.input
          if (!actions || typeof actions.setDraft !== 'function') throw new Error('The target session input area is unavailable')
          let next = text
          if (append && input && typeof input.getSnapshot === 'function') {
            const snap = input.getSnapshot()
            const previous = snap && typeof snap.draft === 'string' ? snap.draft : ''
            if (previous.trim()) next = previous.replace(/\s+$/, '') + '\n\n' + text
          }
          actions.setDraft(next)
        })
      }

      const createSelectedFlowSession = async () => {
        if (!flowSelectedSeqs.length) return
        if (!sessionsClient || typeof sessionsClient.create !== 'function') { setError('This Harness version does not support creating an empty session'); return }
        setFlowUiBusy(true); setFlowUiNotice('Creating a new session from selected content…')
        try {
          const context = await fetchSelectedFlowContext()
          const sessionId = await sessionsClient.create(currentCwd ? { cwd: currentCwd } : {})
          await putFlowContextIntoDraft(sessionId, context.text, false)
          await navigateHarnessSession({ sessionId })
          setFlowSelectedSeqs([])
          setFlowBringPopup(false)
          setFlowTreeOpen({})
          setFlowUiNotice('Created a new session draft containing only the selected content')
        } catch (e) { setError('Createsessionfailed: ' + String((e && e.message) || e)) }
        finally { setFlowUiBusy(false) }
      }

      const sendSelectedFlow = async () => {
        const target = flowTargetSession
        if (!target) { setFlowUiNotice('Selecttargetsession'); return }
        if (!sessionsClient) { setFlowUiNotice('The Harness session service is unavailable'); return }
        setFlowUiBusy(true); setFlowUiNotice('Preparing and adding selected content…')
        try {
          const context = await fetchSelectedFlowContext()
          await putFlowContextIntoDraft(target, context.text, true)
          await navigateHarnessSession({ sessionId: target })
          setFlowSelectedSeqs([])
          setFlowBringPopup(false)
          setFlowTreeOpen({})
          setFlowUiNotice('Added content to the target session draft')
        } catch (e) { setFlowUiNotice('Addfailed: ' + String((e && e.message) || e)) }
        finally { setFlowUiBusy(false) }
      }

      const resolveZoomBinding = async (sid) => {
        for (let i = 0; i < 10; i++) {
          try {
            const b = sessionsClient && typeof sessionsClient.binding === 'function' ? sessionsClient.binding(sid) : undefined
            if (b && b.session && typeof b.session.prompt === 'function') return b
          } catch (e) {}
          await new Promise((r) => setTimeout(r, 150))
        }
        return undefined
      }
      const withZoomBinding = async (sid, operation) => {
        if (sessionsClient && typeof sessionsClient.using === 'function') {
          return sessionsClient.using(sid, { source: 'controllerOperation' }, (reference) => operation(reference.binding))
        }
        const binding = await resolveZoomBinding(sid)
        if (!binding) throw new Error('The session is unavailable or offline')
        return operation(binding)
      }
      const sendTextToSession = async (sid, text) => {
        await withZoomBinding(sid, async (binding) => {
          const res = await binding.session.prompt([{ type: 'text', text }], 'queue')
          if (!res || res.ok !== true) throw new Error((res && res.error && res.error.message) || 'Sendwas rejected')
        })
      }
      const zoomLaneValues = () => {
        const b = flowZoomHostEl()
        if (!b) return []
        return [...b.querySelectorAll('[data-zoom-lane]')].map((s) => String(s.value || ''))
      }
      const zoomEffortValues = () => {
        const b = flowZoomHostEl()
        if (!b) return []
        return [...b.querySelectorAll('[data-zoom-effort]')].map((s) => String(s.value || ''))
      }
      const selectSessionModel = async (sid, route, reasoningEffort) => {
        const slash = route.indexOf('/')
        if (slash <= 0) return
        const remoteSession = ctx.get('remote.session')
        if (!remoteSession || typeof remoteSession.selectModel !== 'function') throw new Error('The model-selection channel is unavailable')
        const res = await remoteSession.selectModel({
          sessionId: sid,
          provider: route.slice(0, slash),
          model: route.slice(slash + 1),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        })
        if (!res || res.ok !== true) throw new Error((res && res.error && res.error.message) || 'selectModel was rejected')
      }
      const renameSession = async (sid, title) => {
        await withZoomBinding(sid, async (binding) => {
          if (!binding.session || typeof binding.session.rename !== 'function') return
          const res = await binding.session.rename(String(title).slice(0, 120))
          if (res && res.ok === false) throw new Error((res.error && res.error.message) || 'sessionfailed')
        })
      }
      const zoomBranchTitle = (prompt, index, count, route) => {
        const task = String(prompt || 'concurrent run').replace(/\s+/g, ' ').trim().slice(0, 42)
        const model = route ? route.slice(route.indexOf('/') + 1) : 'Current '
        return '⚡ ' + task + ' · branch ' + (index + 1) + '/' + count + ' · ' + model
      }
      const currentSessionIsBlank = (sessionId) => {
        const row = sessionId ? flowSessionRow(sessionId) : null
        if (row && typeof row.blank === 'boolean') return row.blank
        try {
          const binding = sessionId && sessionsClient && typeof sessionsClient.binding === 'function'
            ? sessionsClient.binding(sessionId)
            : null
          const source = binding && binding.eventSource
          const snap = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : null
          return !!(snap && Array.isArray(snap.entries) && snap.entries.length === 0)
        } catch (e) { return false }
      }
      const executeZoomLaunch = async () => {
        const prompt = zoomComposerText().trim()
        if (!prompt) { setFlowUiNotice('Enter a shared task before starting all branches'); return }
        const lanes = zoomLaneValues()
        const efforts = zoomEffortValues()
        const board = flowZoomHostEl()
        const activeSids = board ? String(board.getAttribute('data-zoom-active-sids') || '').split(',').filter(Boolean).slice(0, 4) : []
        const continueExisting = activeSids.length >= 2
        const count = continueExisting ? activeSids.length : Math.max(1, Math.min(4, lanes.length || 2))
        const reuseEl = !continueExisting && board && !board.hasAttribute('data-flow-board') ? board.querySelector('[data-zoom-reuse]') : null
        const reuseCurrent = !!(reuseEl && reuseEl.getAttribute('aria-pressed') === 'true')
        const sourceSessionId = harnessSelectedSessionId || currentSessionId || flowScope()
        const effSourceId = reuseCurrent ? (flowScope() || sourceSessionId) : sourceSessionId
        let launchCwd = currentCwd
        let launchWorkspaceId = ''
        if (sourceSessionId && Array.isArray(hookWorkspaceItems)) {
          const owner = hookWorkspaceItems.find((w) => w && Array.isArray(w.sessionIds) && w.sessionIds.some((sid) => String(sid) === sourceSessionId))
          if (owner && owner.workspaceId != null) launchWorkspaceId = String(owner.workspaceId)
        }
        if (!launchWorkspaceId && sourceSessionId && workspacesClient && workspacesClient.list && typeof workspacesClient.list.getSnapshot === 'function') {
          try {
            const snapshot = workspacesClient.list.getSnapshot()
            const owner = snapshot && Array.isArray(snapshot.items)
              ? snapshot.items.find((w) => w && Array.isArray(w.sessionIds) && w.sessionIds.some((sid) => String(sid) === sourceSessionId))
              : null
            if (owner && owner.workspaceId != null) launchWorkspaceId = String(owner.workspaceId)
          } catch (e) {}
        }
        if (sourceSessionId) {
          try {
            const info = await host.call(RT.rpc('session-info'), { session: sourceSessionId })
            if (info && info.ok && typeof info.cwd === 'string' && info.cwd) launchCwd = info.cwd
            if (!launchWorkspaceId && info && info.ok && typeof info.workspaceId === 'string' && info.workspaceId) launchWorkspaceId = info.workspaceId
          } catch (e) {}
        }
        const forkCurrent = !continueExisting && Boolean(effSourceId) && !currentSessionIsBlank(effSourceId)
        if (!sessionsClient) { setError('The Harness session service is unavailable'); setFlowUiNotice('Start-all failed:The Harness session service is unavailable'); return }
        if (forkCurrent && typeof sessionsClient.fork !== 'function') { setError('This Harness version cannot branch from an existing session'); setFlowUiNotice('Start-all failed:session branching is unavailable'); return }
        if (!forkCurrent && !continueExisting && typeof sessionsClient.create !== 'function') { setError('This Harness version cannot create concurrent sessions'); setFlowUiNotice('Start-all failed:session creation is unavailable'); return }
        setFlowUiBusy(true); setFlowUiNotice(reuseCurrent
          ? 'Starting with the current session (Create ' + Math.max(0, count - 1) + ' branch)…'
          : continueExisting
            ? 'Continuing the current ' + count + ' branch…'
            : '' + (forkCurrent ? 'branching from the current session ' : 'creating in the current workspace ') + count + ' session…')
        const created = []
        const failed = []
        try {
          if (reuseCurrent) {
            const spawned = []
            for (let i = 1; i < count; i++) {
              try {
                const sid = forkCurrent
                  ? await sessionsClient.fork({ sessionId: effSourceId, increaseTitle: true })
                  : await sessionsClient.create(launchWorkspaceId ? { workspaceId: launchWorkspaceId } : (launchCwd ? { cwd: launchCwd } : {}))
                const route = lanes[i] || ''
                if (route) await selectSessionModel(sid, route, efforts[i] || '')
                await renameSession(sid, zoomBranchTitle(prompt, i, count, route))
                spawned.push(sid)
              } catch (e) { failed.push(String((e && e.message) || e)) }
            }
            try {
              const route0 = lanes[0] || ''
              if (route0) await selectSessionModel(effSourceId, route0, efforts[0] || '')
              await sendTextToSession(effSourceId, prompt)
              created.push(effSourceId)
            } catch (e) { failed.push(String((e && e.message) || e)) }
            for (const sid of spawned) {
              try { await sendTextToSession(sid, prompt); created.push(sid) } catch (e) { failed.push(String((e && e.message) || e)) }
            }
          } else {
          for (let i = 0; i < count; i++) {
            try {
              const sid = continueExisting
                ? activeSids[i]
                : forkCurrent
                  ? await sessionsClient.fork({ sessionId: sourceSessionId, increaseTitle: true })
                  : await sessionsClient.create(launchWorkspaceId ? { workspaceId: launchWorkspaceId } : (launchCwd ? { cwd: launchCwd } : {}))
              const route = lanes[i] || ''
              if (route) await selectSessionModel(sid, route, efforts[i] || '')
              if (!continueExisting) await renameSession(sid, zoomBranchTitle(prompt, i, count, route))
              await sendTextToSession(sid, prompt)
              created.push(sid)
            } catch (e) { failed.push(String((e && e.message) || e)) }
          }
          }
          if (created.length && typeof loadPanelRef.current === 'function') {
            const joinedSids = continueExisting ? activeSids : created
            loadPanelRef.current('flow', 'fzoom-joined', { dataset: {
              sids: joinedSids.join(','),
              meta: JSON.stringify({
                prompt, routes: lanes.slice(0, count), efforts: efforts.slice(0, count),
                sourceSids: continueExisting ? activeSids : (effSourceId ? [effSourceId] : []),
                baseHistoryId: continueExisting && board ? (board.getAttribute('data-zoom-run-id') || '') : '',
                baseRoundId: continueExisting && board ? (board.getAttribute('data-zoom-round-id') || '') : '',
                ...(!continueExisting && board && !board.hasAttribute('data-flow-board') && effSourceId ? { linkSource: effSourceId } : {}),
              }),
            } }, { silent: true })
          }
          if (!forkCurrent && !reuseCurrent && created.length) {
            const target = created[0]
            const followState = stateRef.current.flow
            if (followState) flowFollowStateBySessionRef.current.set(target, followState)
            flowHarnessNavTargetRef.current = target
            try { await navigateHarnessSession({ sessionId: target }) }
            catch (e) {
              flowHarnessNavTargetRef.current = null
              flowFollowStateBySessionRef.current.delete(target)
              throw e
            }
          }
          const input = board && board.querySelector('[data-zoom-prompt]')
          if (input) input.value = ''
          zoomPromptRef.current = ''
          setFlowUiNotice((reuseCurrent
            ? 'Started using the current session' + (created.length > 1 ? ',Create ' + (created.length - 1) + ' branch' : '')
            : continueExisting
              ? 'Continued the current ' + created.length + ' branch'
              : '' + (forkCurrent ? 'branching from the current session' : 'creating in the current workspace') + ' ' + created.length + ' session') + (failed.length ? ',' + failed.length + ' failed:' + failed[0] : ''))
        } catch (e) { setError('Start-all failed: ' + String((e && e.message) || e)) }
        finally { setFlowUiBusy(false) }
      }
      const executeZoomRoundFork = async (el) => {
        if (!sessionsClient || typeof sessionsClient.fork !== 'function') { setError('This Harness version does not support session branching'); return }
        let spec = []
        try { spec = JSON.parse(el.getAttribute('data-spec') || '[]') } catch (e) {}
        spec = Array.isArray(spec) ? spec.filter((x) => x && typeof x.sid === 'string' && Number.isFinite(Number(x.seq))).slice(0, 4) : []
        if (spec.length < 2) { setFlowUiNotice('This round requires at least two branchable sessions'); return }
        const turn = el.getAttribute('data-turn') || ''
        const targetCount = Math.max(2, Math.min(4, zoomLaneValues().length || spec.length))
        const baseHistoryId = el.getAttribute('data-history') || ''
        const baseRoundId = el.getAttribute('data-round') || ''
        setFlowUiBusy(true); setFlowUiNotice('Processing round  ' + turn + ' round ' + spec.length + '→' + targetCount + '…')
        const created = [], failed = []
        try {
          for (let i = 0; i < targetCount; i++) {
            const item = spec[i % spec.length]
            try {
              const child = await sessionsClient.fork({ sessionId: item.sid, atSeq: Number(item.seq), increaseTitle: true })
              await renameSession(child, '⚡  ' + turn + ' round · branch ' + (i + 1) + '/' + targetCount)
              created.push(child)
            }
            catch (e) { failed.push(String((e && e.message) || e)) }
          }
          if (created.length && typeof loadPanelRef.current === 'function') {
            await loadPanelRef.current('flow', 'fzoom-joined', { dataset: {
              sids: created.join(','),
              meta: JSON.stringify({ prompt: ' ' + turn + ' roundconcurrent run', routes: created.map(() => ''), efforts: created.map(() => ''), sourceSids: spec.map((x) => x.sid), baseHistoryId, baseRoundId }),
            } }, { silent: true })
          }
          setFlowUiNotice('Round  ' + turn + ' round ' + spec.length + '→' + created.length + (failed.length ? ',failed ' + failed.length + ' :' + failed[0] : ''))
        } finally { setFlowUiBusy(false) }
      }
      const executeZoomCellFork = async (sourceSid, seq, turn, baseHistoryId, baseRoundId) => {
        if (!sourceSid || !Number.isFinite(Number(seq)) || !sessionsClient || typeof sessionsClient.fork !== 'function') return
        const targetCount = Math.max(2, Math.min(4, zoomLaneValues().length || 2))
        setFlowUiBusy(true); setFlowUiNotice('Processing round  ' + turn + ' roundCreate 1→' + targetCount + ' branch…')
        try {
          const created = []
          for (let i = 0; i < targetCount; i++) {
            const child = await sessionsClient.fork({ sessionId: sourceSid, atSeq: Number(seq), increaseTitle: true })
            await renameSession(child, '⚡  ' + turn + ' round · branch ' + (i + 1) + '/' + targetCount)
            created.push(child)
          }
          if (typeof loadPanelRef.current === 'function') {
            loadPanelRef.current('flow', 'fzoom-joined', { dataset: {
              sids: created.join(','),
              meta: JSON.stringify({ prompt: ' ' + turn + ' roundbranch', routes: created.map(() => ''), efforts: created.map(() => ''), sourceSids: [sourceSid], baseHistoryId, baseRoundId }),
            } }, { silent: true })
          }
          setFlowUiNotice('Round  ' + turn + ' round 1→' + targetCount + ' branch')
        } catch (e) { setError('This round failed to branch: ' + String((e && e.message) || e)) }
        finally { setFlowUiBusy(false) }
      }
      const executeZoomAddNewSession = async () => {
        if (!sessionsClient || typeof sessionsClient.create !== 'function') { setFlowUiNotice('This versiondoes not supportCreate Session'); return }
        const sourceSessionId = harnessSelectedSessionId || currentSessionId || flowScope()
        let workspaceId = ''
        if (sourceSessionId && Array.isArray(hookWorkspaceItems)) {
          const owner = hookWorkspaceItems.find((w) => w && Array.isArray(w.sessionIds) && w.sessionIds.some((sid) => String(sid) === sourceSessionId))
          if (owner && owner.workspaceId != null) workspaceId = String(owner.workspaceId)
        }
        setFlowUiBusy(true); setFlowUiNotice('Creating a session and adding it to the current concurrent run…')
        try {
          const sid = await sessionsClient.create(workspaceId ? { workspaceId } : (currentCwd ? { cwd: currentCwd } : {}))
          await renameSession(sid, '⚡ Added to current concurrent run · New session')
          if (typeof loadPanelRef.current === 'function') {
            await loadPanelRef.current('flow', 'fzoom-run-add', { dataset: { sid } }, { silent: true })
          }
          setFlowUiNotice('Created and added Session ' + String(sid).replace(/^session-/, '').slice(0, 8))
        } catch (e) { setError('Failed to create and add: ' + String((e && e.message) || e)) }
        finally { setFlowUiBusy(false) }
      }
      const executeZoomCast = async (send) => {
        const text = (zoomRelay && zoomRelay.text ? zoomRelay.text : zoomComposerText()).trim()
        const targets = zoomPick.filter((sid) => !zoomRelay || sid !== zoomRelay.source)
        if (!text) { setFlowUiNotice('Enter a task first, or click ⇪ on a card to use its latest conclusion'); return }
        if (!targets.length) { setFlowUiNotice('Select at least one target session first'); return }
        setFlowUiBusy(true); setFlowUiNotice(send ? 'Sending directly to selected sessions…' : 'Adding content to selected session drafts…')
        let okCount = 0, failCount = 0, firstErr = ''
        try {
          for (const sid of targets) {
            try {
              if (send) await sendTextToSession(sid, text)
              else await putFlowContextIntoDraft(sid, text, true)
              okCount++
            } catch (e) { failCount++; if (!firstErr) firstErr = String((e && e.message) || e) }
          }
          setFlowUiNotice((send ? 'Send directly ' : 'Adddraft ') + okCount + ' session' + (failCount ? ',' + failCount + ' failed:' + firstErr : ''))
          setZoomPick([]); setZoomRelay(null)
          if (!zoomRelay) {
            const board = flowZoomHostEl()
            const input = board && board.querySelector('[data-zoom-prompt]')
            if (input) input.value = ''
            zoomPromptRef.current = ''
          }
        } finally { setFlowUiBusy(false) }
      }

      React.useEffect(() => {
        const flow = panelRef.current && panelRef.current.querySelector('[data-flow]')
        if (!flow || active !== 'flow') return
        const body = flow.querySelector('.tb-pane-body')
        if (body) body.style.setProperty('--tb-flow-zoom', String(flowZoom / 100))
      }, [active, html, flowZoom])

      React.useEffect(() => {
        const root = panelRef.current
        const viewport = root && root.querySelector('[data-flow-mindmap]')
        if (!viewport || active !== 'flow') return undefined
        const canvas = viewport.querySelector('.fl-mindmap-canvas')
        if (!canvas) return undefined
        const scope = viewport.getAttribute('data-map-scope') || 'current'
        const keyOf = (node) => scope + '/' + (node.getAttribute('data-map-node') || '')
        const nodes = [...canvas.querySelectorAll('[data-map-node]')]
        for (const node of nodes) {
          const saved = flowMindMapPositionsRef.current.get(keyOf(node))
          if (saved) { node.style.left = saved.x + 'px'; node.style.top = saved.y + 'px' }
        }
        const updateEdges = () => {
          const base = canvas.getBoundingClientRect()
          const sx = canvas.offsetWidth ? base.width / canvas.offsetWidth : 1
          const sy = canvas.offsetHeight ? base.height / canvas.offsetHeight : 1
          const rect = (r) => ({ x: (r.left - base.left) / sx, y: (r.top - base.top) / sy, w: r.width / sx, h: r.height / sy })
          const nodeRects = new Map([...canvas.querySelectorAll('[data-map-node]')].map((node) => [node.getAttribute('data-map-node') || '', rect(node.getBoundingClientRect())]))
          for (const path of canvas.querySelectorAll('[data-map-from][data-map-to]')) {
            const fromId = path.getAttribute('data-map-from') || ''
            const toId = path.getAttribute('data-map-to') || ''
            const ar = nodeRects.get(fromId), br = nodeRects.get(toId)
            if (!ar || !br) continue
            const acx = ar.x + ar.w / 2, acy = ar.y + ar.h / 2
            const bcx = br.x + br.w / 2, bcy = br.y + br.h / 2
            const dx = bcx - acx, dy = bcy - acy
            const vertical = br.y >= ar.y + ar.h + 12 || ar.y >= br.y + br.h + 12
            const x1 = vertical ? acx : (dx >= 0 ? ar.x + ar.w : ar.x)
            const y1 = vertical ? (dy >= 0 ? ar.y + ar.h : ar.y) : acy
            const x2 = vertical ? bcx : (dx >= 0 ? br.x : br.x + br.w)
            const y2 = vertical ? (dy >= 0 ? br.y : br.y + br.h) : bcy
            let blocked = false
            for (const [id, obstacle] of nodeRects) {
              if (id === fromId || id === toId) continue
              const left = obstacle.x - 8, right = obstacle.x + obstacle.w + 8
              const top = obstacle.y - 8, bottom = obstacle.y + obstacle.h + 8
              for (let step = 1; step < 24; step++) {
                const t = step / 24
                const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t
                if (px >= left && px <= right && py >= top && py <= bottom) { blocked = true; break }
              }
              if (blocked) break
            }
            let d = 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2
            if (blocked && !vertical) {
              const mid = (x1 + x2) / 2
              d = 'M ' + x1 + ' ' + y1 + ' H ' + mid + ' V ' + y2 + ' H ' + x2
            } else if (blocked) {
              const mid = (y1 + y2) / 2
              d = 'M ' + x1 + ' ' + y1 + ' V ' + mid + ' H ' + x2 + ' V ' + y2
            }
            path.setAttribute('d', d)
          }
        }
        updateEdges()
        let drag = null
        const onDown = (e) => {
          if (e.button !== 0 || (e.target && e.target.closest && e.target.closest('button,a,input,select,textarea'))) return
          const node = e.target && e.target.closest ? e.target.closest('[data-map-node]') : null
          if (node) {
            const base = canvas.getBoundingClientRect()
            const scale = canvas.offsetWidth ? base.width / canvas.offsetWidth : 1
            drag = { kind: 'node', node, x: e.clientX, y: e.clientY, left: parseFloat(node.style.left) || 0, top: parseFloat(node.style.top) || 0, scale }
          } else {
            drag = { kind: 'pan', x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }
            viewport.classList.add('is-panning')
          }
          try { viewport.setPointerCapture(e.pointerId) } catch (err) {}
          e.preventDefault()
        }
        const onMove = (e) => {
          if (!drag) return
          if (drag.kind === 'node') {
            const x = Math.max(0, drag.left + (e.clientX - drag.x) / drag.scale)
            const y = Math.max(0, drag.top + (e.clientY - drag.y) / drag.scale)
            drag.node.style.left = x + 'px'; drag.node.style.top = y + 'px'
            flowMindMapPositionsRef.current.set(keyOf(drag.node), { x, y })
            updateEdges()
          } else {
            viewport.scrollLeft = drag.left - (e.clientX - drag.x)
            viewport.scrollTop = drag.top - (e.clientY - drag.y)
          }
          e.preventDefault()
        }
        const finish = (e) => {
          if (!drag) return
          drag = null
          viewport.classList.remove('is-panning')
          try { viewport.releasePointerCapture(e.pointerId) } catch (err) {}
        }
        const reset = root.querySelector('[data-map-reset]')
        const onReset = () => {
          for (const node of nodes) {
            const x = Number(node.getAttribute('data-map-default-x')) || 0
            const y = Number(node.getAttribute('data-map-default-y')) || 0
            node.style.left = x + 'px'; node.style.top = y + 'px'
            flowMindMapPositionsRef.current.delete(keyOf(node))
          }
          viewport.scrollLeft = 0; viewport.scrollTop = 0; updateEdges()
        }
        viewport.addEventListener('pointerdown', onDown)
        viewport.addEventListener('pointermove', onMove)
        viewport.addEventListener('pointerup', finish)
        viewport.addEventListener('pointercancel', finish)
        if (reset) reset.addEventListener('click', onReset)
        return () => {
          viewport.removeEventListener('pointerdown', onDown)
          viewport.removeEventListener('pointermove', onMove)
          viewport.removeEventListener('pointerup', finish)
          viewport.removeEventListener('pointercancel', finish)
          if (reset) reset.removeEventListener('click', onReset)
        }
      }, [active, html])

      React.useEffect(() => {
        const root = panelRef.current
        const drop = root && root.querySelector('[data-zoom-add-drop]')
        if (!drop || active !== 'flow') return undefined
        const candidates = [...root.querySelectorAll('[data-zoom-add-drag][data-sid]')]
        const onStart = (e) => {
          const sid = e.currentTarget.getAttribute('data-sid') || ''
          if (!sid || !e.dataTransfer) return
          e.dataTransfer.effectAllowed = 'copy'
          e.dataTransfer.setData('text/plain', sid)
        }
        const onOver = (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; drop.classList.add('is-drop-target') }
        const onLeave = (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('is-drop-target') }
        const onDrop = (e) => {
          e.preventDefault(); drop.classList.remove('is-drop-target')
          const sid = e.dataTransfer ? e.dataTransfer.getData('text/plain') : ''
          if (/^[\w-]{1,100}$/.test(sid) && typeof loadPanelRef.current === 'function') {
            loadPanelRef.current('flow', 'fzoom-run-add', { dataset: { sid } }, { silent: true })
          }
        }
        for (const candidate of candidates) candidate.addEventListener('dragstart', onStart)
        drop.addEventListener('dragover', onOver)
        drop.addEventListener('dragleave', onLeave)
        drop.addEventListener('drop', onDrop)
        return () => {
          for (const candidate of candidates) candidate.removeEventListener('dragstart', onStart)
          drop.removeEventListener('dragover', onOver)
          drop.removeEventListener('dragleave', onLeave)
          drop.removeEventListener('drop', onDrop)
        }
      }, [active, html])

      React.useEffect(() => {
        const flow = panelRef.current && panelRef.current.querySelector('[data-flow]')
        const body = flow && flow.querySelector('.tb-pane-body')
        if (!flow || !body || active !== 'flow') return undefined
        if (flow.hasAttribute('data-flow-board')) return undefined
        flow.setAttribute('data-flow-select-mode', '1')
        for (const card of flow.querySelectorAll('[data-flow-select-seq]')) {
          const seq = Number(card.getAttribute('data-flow-select-seq'))
          card.classList.toggle('fl-select-picked', flowSelectedSeqs.includes(seq))
        }
        let drag = null
        const clearDrag = () => {
          if (!drag) return
          if (drag.box) { try { drag.box.remove() } catch (e) {} }
          drag = null
        }
        const onDown = (e) => {
          if (e.button !== 0) return
          const rect = body.getBoundingClientRect()
          if (e.clientX > rect.right - 14) return
          const origin = flow.getBoundingClientRect()
          drag = { x: e.clientX, y: e.clientY, originX: origin.left, originY: origin.top, box: null, moved: false, pointerId: e.pointerId }
        }
        const onMove = (e) => {
          if (!drag) return
          const left = Math.min(drag.x, e.clientX), top = Math.min(drag.y, e.clientY)
          const width = Math.abs(e.clientX - drag.x), height = Math.abs(e.clientY - drag.y)
          if (!drag.moved && (width > 3 || height > 3)) {
            const flow = panelRef.current && panelRef.current.querySelector('[data-flow]')
            if (!flow) { clearDrag(); return }
            const box = document.createElement('div')
            box.className = 'fl-marquee'
            flow.appendChild(box)
            drag.box = box
            drag.moved = true
            const body = flow.querySelector('.tb-pane-body')
            try { if (body && drag.pointerId != null) body.setPointerCapture(drag.pointerId) } catch (err) {}
          }
          if (!drag.moved || !drag.box) return
          if (drag.moved) e.preventDefault()
          Object.assign(drag.box.style, { left: (left - drag.originX) + 'px', top: (top - drag.originY) + 'px', width: width + 'px', height: height + 'px' })
        }
        const onUp = (e) => {
          if (!drag) return
          const d = drag
          if (d.moved) {
            const sel = d.box.getBoundingClientRect()
            const seqs = new Set()
            for (const card of flow.querySelectorAll('[data-flow-select-seq]')) {
              const r = card.getBoundingClientRect()
              if (r.right >= sel.left && r.left <= sel.right && r.bottom >= sel.top && r.top <= sel.bottom) {
                const seq = Number(card.getAttribute('data-flow-select-seq'))
                if (Number.isFinite(seq)) seqs.add(seq)
              }
            }
            setFlowSelectedSeqs([...seqs].sort((a, b) => a - b))
            setFlowBringPopup(false)
            setFlowUiNotice('')
            suppressFlowClickUntilRef.current = Date.now() + 120
          } else if (!e.button && !flowUiBusy && (flowSelectedSeqs.length || flow.querySelector('.fl-rail'))) {
            const t = e.target
            if (t && typeof t.closest === 'function'
              && !t.closest('[data-flow-select-seq]')
              && !t.closest('button,a,input,select,textarea,label')) {
              if (flowSelectedSeqs.length) { setFlowSelectedSeqs([]); setFlowBringPopup(false) }
              const railX = flow.querySelector('.fl-rail-x')
              if (railX && typeof loadPanelRef.current === 'function') loadPanelRef.current('flow', 'fdetail', railX)
            }
          }
          clearDrag()
          try { if (d.pointerId != null) body.releasePointerCapture(d.pointerId) } catch (err) {}
        }
        body.addEventListener('pointerdown', onDown)
        body.addEventListener('pointermove', onMove)
        body.addEventListener('pointerup', onUp)
        body.addEventListener('pointercancel', onUp)
        return () => {
          clearDrag()
          try { body.removeEventListener('pointerdown', onDown); body.removeEventListener('pointermove', onMove); body.removeEventListener('pointerup', onUp); body.removeEventListener('pointercancel', onUp) } catch (e) {}
        }
      }, [active, html, flowSelectedSeqs, flowUiBusy])

      React.useEffect(() => {
        if (active !== 'flow') return undefined
        const pane = panelRef.current
        if (!pane) return undefined
        const onComposerBlankDown = (e) => {
          if (e.button !== 0 || flowUiBusy) return
          if (!pane.querySelector('.fl-zoom-composer')) return
          const t = e.target
          if (!t || typeof t.closest !== 'function') return
          if (t.closest('.fl-zoom-composer,[data-action="fzoom-composer"],.tb-flow-add-popup,.tb-flow-bring-popup,.fl-rail,.fl-zoom-history-drawer,button,a,input,select,textarea,label,[data-action],[data-flow-branch],[data-flow-select-seq],[data-map-node],[data-zoom-add-drop]')) return
          if (typeof loadPanelRef.current === 'function') loadPanelRef.current('flow', 'fzoom-composer', null)
        }
        pane.addEventListener('pointerdown', onComposerBlankDown)
        return () => { try { pane.removeEventListener('pointerdown', onComposerBlankDown) } catch (e) {} }
      }, [active, html, flowUiBusy])

      React.useEffect(() => {
        const board = flowZoomHostEl()
        if (active !== 'flow' || !board) {
          if (zoomPick.length) setZoomPick([])
          if (zoomRelay) setZoomRelay(null)
          zoomPromptRef.current = ''
          return
        }
        board.classList.toggle('fl-zoom-picking', !!zoomRelay)
        for (const card of board.querySelectorAll('[data-sid]')) {
          const sid = card.getAttribute('data-sid') || ''
          card.classList.toggle('fl-zoom-picked', zoomPick.includes(sid))
        }
        const input = board.querySelector('[data-zoom-prompt]')
        if (input && input.value !== zoomPromptRef.current) input.value = zoomPromptRef.current
      }, [active, html, zoomPick, zoomRelay])

      function collectFields() {
        const fields = {}
        const box = panelRef.current
        if (!box) return fields
        const nodes = box.querySelectorAll('[data-field]')
        for (const el of nodes) {
          const name = el.getAttribute('data-field')
          if (name) fields[name] = el.value == null ? '' : String(el.value)
        }
        return fields
      }

      async function loadPanel(toolId, action, el, opts) {
        if (!toolId) { setHtml(null); return }
        attemptedRef.current[toolId] = true
        const silent = Boolean(opts && opts.silent)
        if ((silent || !action) && interactiveActionSeqRef.current[toolId]) return
        const seq = (seqRef.current[toolId] || 0) + 1
        seqRef.current[toolId] = seq
        if (!silent && action) interactiveActionSeqRef.current[toolId] = seq
        if (!silent) setBusyTool(toolId)
        if (!silent) setError(null)
        let locked = null
        const unlock = () => { if (locked) for (const s of locked) { try { s.disabled = false } catch (e) {} } }
        try {
          if (toolId === 'flow') {
            const currentFlow = panelRef.current && panelRef.current.querySelector('[data-flow][data-flow-scope]')
            const currentBody = currentFlow && currentFlow.querySelector('.tb-pane-body')
            const currentScope = currentFlow && (currentFlow.getAttribute('data-flow-scope') || '')
            if (currentBody && currentScope && (action === 'fenter' || action === 'fback')) {
              flowScrollByScopeRef.current.set(currentScope, currentBody.scrollTop)
              flowScrollIntentRef.current = action === 'fback' ? 'back' : 'enter'
            }
            if (action === 'fmore') flowSuppressHistoryAnimRef.current = true
          }
          let fields = collectFields()
          const persistFlowRules = toolId === 'flow' && ['fsave-rule', 'fcreate-rule', 'fapply-rule-json', 'ftoggle-rule', 'fdelete-rule', 'freset-rules'].includes(action)
          if (toolId === 'flow') {
            fields.__flowPresentationRules = readFlowRules()
            fields.__flowPreferences = JSON.stringify(readFlowPreferences())
            fields.__flowZoomLog = JSON.stringify(readFlowZoomLog())
            fields.__flowArchivedSessionIds = JSON.stringify(archivedSessionIds)
            fields.__flowSessionIndex = JSON.stringify(flowSessionIds.slice(0, 200).map((id) => {
              const row = flowSessionRow(id) || {}
              return { id: String(id), title: String(row.displayTitle || row.title || '').slice(0, 160), cwd: String(row.cwd || '').slice(0, 260) }
            }).filter((x) => x.id && x.title))
          }
          if (el) {
            const ds = el.dataset || {}
            const d = {}
            for (const k of Object.keys(ds)) d[k] = ds[k]
            fields = { ...fields, __el: d }
          }
          if (opts && opts.lockSelects) {
            const box = panelRef.current
            if (box) {
              locked = [...box.querySelectorAll('select:not([disabled])')]
              for (const s of locked) s.disabled = true
            }
          }
          const callP = host.call(RT.rpc('panel'), {
            tool: toolId,
            action: action || '',
            fields,
            state: stateRef.current[toolId] || null,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
            live: toolId === 'flow' && liveOverlayRef.current
              && ((liveOverlayRef.current.attempts && liveOverlayRef.current.attempts.length)
                || (liveOverlayRef.current.settled && liveOverlayRef.current.settled.length))
              ? liveOverlayRef.current
              : undefined,
          })
          const timeoutP = new Promise((_, reject) => {
            try { ctx.timeout(() => reject(new Error('Panel request timed out (5s)')), 5000) } catch (e) {}
          })
          const res = await Promise.race([callP, timeoutP])
          if (seqRef.current[toolId] !== seq) return
          if (res && res.ok) {
            if (persistFlowRules) writeFlowRules(JSON.stringify((res.state && res.state.presentationRules) || []))
            retryCountRef.current[toolId] = 0
            stateRef.current[toolId] = res.state
            htmlRef.current[toolId] = res.html
            if (toolId === 'flow' && ['fzoom', 'fzoom-open', 'fzoom-joined', 'fzoom-run', 'fzoom-round', 'fzoom-view', 'fzoom-focus-back', 'fzoom-focus-current', 'fzoom-run-add', 'fzoom-run-remove'].includes(action)) writeFlowZoomLog(res.state)
            const currentFlow = panelRef.current && panelRef.current.querySelector('[data-flow][data-flow-scope]')
            const currentScope = currentFlow && (currentFlow.getAttribute('data-flow-scope') || '')
            const scopeMatch = /data-flow-scope="([^"]*)"/.exec(res.html)
            const nextScope = scopeMatch ? scopeMatch[1] : ''
            if (toolId === 'flow' && currentScope && nextScope && currentScope !== nextScope && !flowScrollIntentRef.current) {
              const currentBody = currentFlow.querySelector('.tb-pane-body')
              if (currentBody) flowScrollByScopeRef.current.set(currentScope, currentBody.scrollTop)
              flowScrollIntentRef.current = 'enter'
            }
            if (panelRef.current && !flowScrollIntentRef.current) {
              try {
                const scrolls = []
                const scrollers = panelRef.current.querySelectorAll('.tb-pane-body, .tb-code, .fl-pre, .tb-desc')
                for (const s of scrollers) scrolls.push(s.scrollTop)
                htmlScrollRef.current = { tool: toolId, scrolls }
              } catch (e) {}
            }
            const deferFlowNavigationRender = toolId === 'flow' && action === 'fzoom-open' && !!res.navigateSession
            if (!deferFlowNavigationRender) setHtml(res.html)
            if (toolId === 'flow' && res.navigateSession) {
              const target = String(res.navigateSession.sessionId || '')
              const oldScope = currentScope || ''
              if (target) {
                flowFollowStateBySessionRef.current.set(target, res.state)
                if (action === 'fback' && oldScope) flowFollowStateBySessionRef.current.delete(oldScope)
                flowHarnessNavTargetRef.current = target
              }
              try { await navigateHarnessSession(res.navigateSession) }
              catch (e) {
                if (flowHarnessNavTargetRef.current === target) flowHarnessNavTargetRef.current = null
                if (target) flowFollowStateBySessionRef.current.delete(target)
                setError('Flowglass switched sessions, but Harness failed to follow: ' + String((e && e.message) || e))
              }
            }
            if (toolId === 'flow' && res.zoomRelay && typeof res.zoomRelay.text === 'string' && res.zoomRelay.text) {
              setZoomRelay({ source: String(res.zoomRelay.sourceSessionId || ''), text: res.zoomRelay.text })
              setFlowUiNotice('thissession —— targetsessionafter"Adddraft"or"Send directly"')
            }
            const am = /data-autorefresh="(\d+)"/.exec(res.html)
            setAutoMs((cur) => {
              const has = Object.prototype.hasOwnProperty.call(cur, toolId)
              if (am) {
                const ms = Math.max(1500, parseInt(am[1], 10) || 2000)
                if (has && cur[toolId] === ms) return cur
                return { ...cur, [toolId]: ms }
              }
              if (!has) return cur
              const next = { ...cur }
              delete next[toolId]
              return next
            })
            const bm = /data-tab-badge="([^"]{0,12})"/.exec(res.html)
            setTabBadges((cur) => {
              const has = Object.prototype.hasOwnProperty.call(cur, toolId)
              const val = bm ? bm[1] : null
              if (val) {
                if (has && cur[toolId] === val) return cur
                return { ...cur, [toolId]: val }
              }
              if (!has) return cur
              const next = { ...cur }
              delete next[toolId]
              return next
            })
            if (typeof res.copy === 'string' && res.copy) {
              try {
                if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                  await navigator.clipboard.writeText(res.copy)
                  setCopied('Copy ' + res.copy.length + ' characters')
                } else {
                  setCopied('The Clipboard API is unavailable in this environment')
                }
              } catch (e) {
                setCopied('Copy failed: ' + String((e && e.message) || e))
              }
            } else {
              setCopied(null)
            }
          } else {
            setError((res && res.error) || 'panelfailed')
            retryOnce(toolId)
          }
        } catch (e) {
          if (seqRef.current[toolId] === seq) {
            setError('panelrequesterror: ' + String((e && e.message) || e))
            retryOnce(toolId)
          }
        } finally {
          unlock()
          if (interactiveActionSeqRef.current[toolId] === seq) delete interactiveActionSeqRef.current[toolId]
          if (seqRef.current[toolId] === seq) setBusyTool((cur) => (cur === toolId ? null : cur))
        }
      }
      function retryOnce(toolId) {
        if ((retryCountRef.current[toolId] || 0) >= 2) return
        retryCountRef.current[toolId] = (retryCountRef.current[toolId] || 0) + 1
        try {
          ctx.timeout(() => {
            const cur = activeRef.current
            if (cur === toolId && openRef.current && typeof loadPanelRef.current === 'function') {
              loadPanelRef.current(toolId, '', null)
            }
          }, 1200)
        } catch (e) {}
      }
      const loadPanelRef = React.useRef(null)
      loadPanelRef.current = loadPanel

      React.useEffect(() => {
        if (!isOpen) return undefined
        const root = drawerRef.current
        if (!root) return undefined
        const onNativeChange = (e) => {
          const t = e.target
          const el = t && t.closest ? t.closest('[data-action-onchange]') : null
          if (!el) return
          const box = panelRef.current
          if (!box || !box.contains(el)) return
          const tool = activeRef.current
          if (!tool || typeof loadPanelRef.current !== 'function') return
          loadPanelRef.current(tool, el.getAttribute('data-action-onchange') || '', el, { lockSelects: true })
        }
        root.addEventListener('change', onNativeChange)
        return () => { try { root.removeEventListener('change', onNativeChange) } catch (err) {} }
      }, [isOpen])

      React.useEffect(() => {
        if (!isOpen || active !== 'flow') return undefined
        const root = panelRef.current
        if (!root) return undefined
        const onFlowScroll = (e) => {
          const body = e.target
          if (!body || !body.classList || !body.classList.contains('tb-pane-body')) return
          const flow = body.closest && body.closest('[data-flow][data-flow-has-older="1"]')
          if (!flow || flowOlderLoadingRef.current) return
          const max = Math.max(0, body.scrollHeight - body.clientHeight)
          if (max <= 0 || Math.abs(max - Math.abs(body.scrollTop)) > 80) return
          flowOlderLoadingRef.current = true
          flowSuppressHistoryAnimRef.current = true
          const load = loadPanelRef.current
          if (typeof load !== 'function') { flowOlderLoadingRef.current = false; return }
          Promise.resolve(load('flow', 'fmore', null, { silent: true }))
            .catch(() => {})
            .finally(() => { flowOlderLoadingRef.current = false })
        }
        root.addEventListener('scroll', onFlowScroll, true)
        return () => { try { root.removeEventListener('scroll', onFlowScroll, true) } catch (e) {} }
      }, [isOpen, active, html])

      async function refreshTools() {
        const list = await fetchTools(cwdRef.current)
        setTools(list)
        if (!list.length) return
        const cur = activeRef.current
        if (cur && list.some((t) => t.id === cur)) return
        const flow = list.find((t) => t.id === 'flow')
        const target = flow ? flow.id : (list.length ? list[0].id : null)
        if (target && catOf(target) !== cat) setCat(catOf(target))
        setActive(target)
      }

      async function refreshPlugins() {
        try {
          const r = await host.call(RT.rpc('plugins'), { session: currentSessionId || undefined })
          setPlugins(r && r.ok && Array.isArray(r.plugins) ? r.plugins : [])
          if (r && r.ok && r.capabilities && typeof r.capabilities === 'object') setPluginCaps(r.capabilities)
        } catch (e) {}
      }

      async function togglePlugin(p) {
        if (p.hasClientHalf) return
        if (p.running && p.canStop === false) return
        setError(null)
        try {
          const r = await host.call(RT.rpc('plugin-toggle'), {
            pluginId: p.pluginId,
            enable: !p.running,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          if (r && !r.ok) setError(r.error || 'pluginoperationfailed')
          else if (r && r.warning) setRebuildLines(['⚠ ' + String(r.warning)])
        } catch (e) {
          setError('pluginoperationerror: ' + String((e && e.message) || e))
        }
        refreshPlugins()
        refreshTools()
      }

      function settleAfterRestart() {
        ctx.timeout(() => {
          refreshTools()
          const t = activeRef.current
          if (t) loadPanel(t, '', null)
        }, 700)
      }

      async function restartPlugin(p) {
        if (p.hasClientHalf) return
        setError(null)
        try {
          const r = await host.call(RT.rpc('plugin-restart'), {
            pluginId: p.pluginId,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          if (r && !r.ok) setError(r.error || 'pluginRerunfailed')
        } catch (e) {
          setError('pluginRerunerror: ' + String((e && e.message) || e))
        }
        refreshPlugins()
        settleAfterRestart()
      }

      async function toggleAll(enable) {
        setError(null)
        try {
          const r = await host.call(RT.rpc('plugin-toggle-all'), { enable, root: currentCwd || undefined, session: currentSessionId || undefined })
          const lines = []
          if (!r) lines.push('Bulk operationdid not respond')
          else {
            if (r.error) lines.push('✗ ' + r.error)
            if (r.warning) lines.push('⚠ ' + String(r.warning))
            if (Array.isArray(r.done) && r.done.length) lines.push((enable ? 'Start: ' : 'Stop: ') + r.done.join(', '))
            if (Array.isArray(r.skippedClient) && r.skippedClient.length) lines.push('Skipped (includes a client half,use the Cordis panel): ' + r.skippedClient.join(', '))
            if (Array.isArray(r.failed) && r.failed.length) lines.push('failed: ' + r.failed.join(';'))
            if (lines.length === 0) lines.push('No eligible plugins')
          }
          setRebuildLines(lines)
        } catch (e) {
          setRebuildLines(['Bulk operationerror: ' + String((e && e.message) || e)])
        }
        refreshPlugins()
        refreshTools()
      }

      async function setDefaultPlugin(p) {
        if (p.defaultStart == null) return
        setError(null)
        try {
          const r = await host.call(RT.rpc('plugin-set-default'), {
            pluginId: p.pluginId,
            enabled: !p.defaultStart,
            root: currentCwd || undefined,
            session: currentSessionId || undefined,
          })
          if (r && !r.ok) setError(r.error || 'default startup settingfailed')
        } catch (e) {
          setError('default startup settingerror: ' + String((e && e.message) || e))
        }
        refreshPlugins()
      }

      async function restartAll() {
        setError(null)
        try {
          const r = await host.call(RT.rpc('plugin-restart-all'), { root: currentCwd || undefined, session: currentSessionId || undefined })
          const lines = []
          if (!r) lines.push('Bulk Rerundid not respond')
          else {
            if (r.error) lines.push('✗ ' + r.error)
            if (Array.isArray(r.done) && r.done.length) lines.push('Rerun: ' + r.done.join(', ') + ' (large panel state such as preview/diff was reset)')
            if (Array.isArray(r.skippedClient) && r.skippedClient.length) lines.push('Skipped (includes a client half,use the Cordis panel): ' + r.skippedClient.join(', '))
            if (Array.isArray(r.failed) && r.failed.length) lines.push('failed: ' + r.failed.join(';'))
            if (lines.length === 0) lines.push('No running host-only plugins')
          }
          setRebuildLines(lines)
        } catch (e) {
          setRebuildLines(['Bulk Rerunerror: ' + String((e && e.message) || e)])
        }
        refreshPlugins()
        settleAfterRestart()
      }

      async function loadRebuildHistory() {
        if (pluginCaps && pluginCaps.rebuildFromDisk === false) { setRebuildHistory([]); return }
        try {
          const r = await host.call(RT.rpc('rebuild-history'))
          setRebuildHistory(r && r.ok && Array.isArray(r.history) ? r.history : [])
        } catch (e) {}
      }

      async function loadAiUsage() {
        if (pluginCaps && pluginCaps.aiUsage === false) { setAiUsage(null); return }
        try {
          const r = await host.call(RT.rpc('ai-usage'))
          setAiUsage(r && r.ok ? r : null)
        } catch (e) {}
      }

      async function runRebuild() {
        setRebuilding(true)
        setError(null)
        try {
          const r = await host.call(RT.rpc('rebuild'), { root: currentCwd || undefined, session: currentSessionId || undefined })
          const lines = []
          if (!r) lines.push('Rebuildrequestdid not respond')
          else {
            if (r.error) lines.push('✗ ' + r.error)
            if (Array.isArray(r.defined) && r.defined.length) lines.push('Newly defined: ' + r.defined.join(', '))
            if (Array.isArray(r.started) && r.started.length) lines.push('Start: ' + r.started.join(', '))
            if (Array.isArray(r.skipped) && r.skipped.length) lines.push('Skipped (defined/framework itself): ' + r.skipped.join(', '))
            if (Array.isArray(r.suppressed) && r.suppressed.length) lines.push('Kept disabled (saved startup state): ' + r.suppressed.join(', '))
            if (Array.isArray(r.failed) && r.failed.length) lines.push('failed: ' + r.failed.join(';'))
            if (typeof r.ms === 'number') lines.push('Elapsed: ' + r.ms + 'ms (payload disk read + define + run sequentially)')
            if (lines.length === 0) lines.push('All plugins in plugins.json already exist; no rebuild is needed')
          }
          setRebuildLines(lines)
        } catch (e) {
          setRebuildLines(['Rebuilderror: ' + String((e && e.message) || e)])
        } finally {
          setRebuilding(false)
        }
        loadRebuildHistory()
        refreshPlugins()
        refreshTools()
      }

      React.useEffect(() => {
        const disp = ctx.interval(() => { if (openRef.current) { refreshTools(); if (managingRef.current) refreshPlugins() } }, 1500)
        const offOpen = store.subscribe(() => {
          if (!store.isOpen()) return
          const remembered = lastNav && lastNav.active
          if (remembered) { setCat(catOf(remembered)); setActive(remembered) }
          else { setCat(catOf('flow')); setActive('flow') }
          refreshTools(); refreshPlugins()
        })
        refreshTools()
        refreshPlugins()
        return () => { try { disp() } catch (e) {} offOpen() }
      }, [])

      React.useEffect(() => {
        const cwd = currentCwd || ''
        const sid = currentSessionId || ''
        if (!sid) return
        if (handledCwdRef.current === cwd && handledSessionRef.current === sid) return
        const cwdChanged = handledCwdRef.current !== cwd
        const sidChanged = handledSessionRef.current !== sid
        handledCwdRef.current = cwd
        handledSessionRef.current = sid
        if (cwdChanged || sidChanged) {
          const isFlowFollow = sidChanged && flowHarnessNavTargetRef.current === sid
          const followState = isFlowFollow ? flowFollowStateBySessionRef.current.get(sid) : null
          htmlRef.current = {}
          stateRef.current = {}
          seqRef.current = {}
          if (followState) stateRef.current.flow = followState
          if (sidChanged) {
            flowHarnessNavTargetRef.current = null
            const keepNativeFlowOpen = readFlowPreferences().keepOpenOnSessionSwitch && nativeFlowVisible
              && (!nativeFlowReopenSession || nativeFlowReopenSession === sid)
            if ((isFlowFollow || keepNativeFlowOpen) && nativeOpenTab) {
              try {
                ctx.timeout(() => {
                  try { nativeOpenTab() } catch (e) {}
                  if (nativeFlowReopenSession === sid) nativeFlowReopenSession = ''
                }, 0)
              } catch (e) {}
            }
            if (!isFlowFollow) {
              flowFollowStateBySessionRef.current.clear()
              flowScrollByScopeRef.current.clear()
              flowScrollIntentRef.current = 'enter'
            }
          }
        }
        if (cwdChanged) {
          attemptedRef.current = {}
          retryCountRef.current = {}
          setHtml(null)
          refreshTools()
        }
        ctx.timeout(() => {
          const t = activeRef.current
          const list = toolsRef.current
          if (t && (!list || list.some((x) => x.id === t)) && typeof loadPanelRef.current === 'function') {
            loadPanelRef.current(t, '', null)
          }
        }, 0)
        refreshPlugins()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [currentCwd, currentSessionId])

      React.useEffect(() => {
        const solo = !managing && tools.length === 1 && tools[0] && tools[0].icon
          ? tools[0].icon : null
        replaceSidebarIcon(solo || ENTRY_NAV_ICON)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [tools, managing])

      const curAutoMs = active ? autoMs[active] : undefined
      React.useEffect(() => {
        if (!isOpen || !active || !curAutoMs) return undefined
        const disp = ctx.interval(() => {
          if (managingRef.current) return
          if (zoomComposerBusy()) return
          if (typeof loadPanelRef.current === 'function') loadPanelRef.current(active, '__refresh', null, { silent: true })
        }, curAutoMs)
        return () => { try { disp() } catch (e) {} }
      }, [isOpen, active, curAutoMs])

      React.useEffect(() => {
        if (!isOpen) return
        if (!active) { lastPanelActiveRef.current = null; setHtml(null); return }
        if (tools.length && !tools.some((t) => t.id === active)) return
        const switched = lastPanelActiveRef.current !== active
        lastPanelActiveRef.current = active
        if (active === 'flow' && switched) {
          stateRef.current[active] = null
          htmlRef.current[active] = null
          htmlScrollRef.current = null
          setHtml(null)
        } else {
          setHtml(htmlRef.current[active] || null)
        }
        loadPanel(active, '', null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [active, isOpen])

      React.useEffect(() => {
        if (!isOpen || !tools.length) return
        if (!active || !tools.some((t) => t.id === active)) {
          const flow = tools.find((t) => t.id === 'flow')
          const target = flow ? flow.id : tools[0].id
          setCat(catOf(target))
          setActive(target)
          return
        }
        if (!attemptedRef.current[active] && typeof loadPanelRef.current === 'function') {
          loadPanelRef.current(active, '', null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [tools, isOpen])

      async function copyFlowRailContent(btn) {
        const sec = btn.closest('.fl-sec')
        const pre = sec && sec.querySelector('.fl-pre')
        const text = pre ? String(pre.textContent || '') : ''
        let ok = false
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text)
            ok = true
          } else {
            const ta = document.createElement('textarea')
            ta.value = text
            ta.setAttribute('readonly', '')
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            document.body.appendChild(ta)
            ta.select()
            ok = document.execCommand('copy')
            ta.remove()
          }
        } catch (e) { ok = false }
        btn.classList.add(ok ? 'fl-copied' : 'fl-copy-fail')
        btn.setAttribute('title', ok ? 'Copy' : 'Copy failed')
        btn.setAttribute('aria-label', ok ? 'Copy' : 'Copy failed')
        ctx.timeout(() => {
          btn.classList.remove('fl-copied', 'fl-copy-fail')
          btn.setAttribute('title', 'Copy content to clipboard')
          btn.setAttribute('aria-label', 'Copy content to clipboard')
        }, 1200)
      }

      function onPanelClick(e) {
        if (!active) return
        const t = e.target
        if (Date.now() < suppressFlowClickUntilRef.current) { e.preventDefault(); return }
        const branch = t && t.closest ? t.closest('[data-flow-branch]') : null
        if (active === 'flow' && branch) {
          e.preventDefault()
          e.stopPropagation()
          const detail = branch.closest('[data-flow-detail-session]')
          const sourceSid = detail ? (detail.getAttribute('data-flow-detail-session') || '') : ''
          const turn = branch.getAttribute('data-turn') || ''
          if (sourceSid && turn) executeZoomCellFork(sourceSid, Number(branch.getAttribute('data-seq')), turn, branch.getAttribute('data-history') || '', branch.getAttribute('data-round') || '')
          else branchFlowAt(Number(branch.getAttribute('data-seq')), sourceSid)
          return
        }
        const previewBtn = t && t.closest ? t.closest('[data-flow-markdown-preview]') : null
        if (active === 'flow' && previewBtn) {
          e.preventDefault()
          e.stopPropagation()
          const key = previewBtn.getAttribute('data-flow-markdown-key') || ''
          setFlowMarkdownPreviewKey((current) => {
            const disabling = current === key
            flowMarkdownDisabledKeyRef.current = disabling ? key : null
            return disabling ? null : key
          })
          return
        }
        const copyBtn = t && t.closest ? t.closest('[data-flow-copy]') : null
        if (active === 'flow' && copyBtn) {
          e.preventDefault()
          e.stopPropagation()
          copyFlowRailContent(copyBtn)
          return
        }
        const ruleEdit = t && t.closest ? t.closest('[data-flow-rule-edit]') : null
        const ruleNew = t && t.closest ? t.closest('[data-flow-rule-new]') : null
        const ruleCancel = t && t.closest ? t.closest('[data-flow-rule-cancel]') : null
        if (active === 'flow' && (ruleEdit || ruleNew || ruleCancel)) {
          e.preventDefault()
          e.stopPropagation()
          const box = panelRef.current
          if (!box) return
          const targetCard = ruleEdit ? ruleEdit.closest('.fl-rule-card') : ruleNew ? box.querySelector('.fl-rule-new') : ruleCancel.closest('.fl-rule-card')
          const opening = !ruleCancel && targetCard && !targetCard.classList.contains('fl-rule-open')
          for (const card of box.querySelectorAll('.fl-rule-card.fl-rule-open')) card.classList.remove('fl-rule-open')
          for (const button of box.querySelectorAll('[data-flow-rule-edit],[data-flow-rule-new]')) button.setAttribute('aria-expanded', 'false')
          if (opening && targetCard) {
            targetCard.classList.add('fl-rule-open')
            const trigger = ruleEdit || ruleNew
            trigger.setAttribute('aria-expanded', 'true')
            const first = targetCard.querySelector('input:not([type="hidden"])')
            if (first && typeof first.focus === 'function') first.focus()
          }
          return
        }
        const zLaunch = t && t.closest ? t.closest('[data-zoom-launch]') : null
        if (active === 'flow' && zLaunch) {
          e.preventDefault()
          e.stopPropagation()
          Promise.resolve(executeZoomLaunch()).catch((err) => {
            const message = 'Start-all failed: ' + String((err && err.message) || err)
            setError(message)
            setFlowUiNotice(message)
            setFlowUiBusy(false)
          })
          return
        }
        const zAddNew = t && t.closest ? t.closest('[data-zoom-add-new]') : null
        if (active === 'flow' && zAddNew) {
          e.preventDefault()
          e.stopPropagation()
          Promise.resolve(executeZoomAddNewSession()).catch((err) => {
            const message = 'Failed to create and add: ' + String((err && err.message) || err)
            setError(message); setFlowUiNotice(message); setFlowUiBusy(false)
          })
          return
        }
        const zAddPicker = t && t.closest ? t.closest('[data-zoom-add-picker]') : null
        if (active === 'flow' && zAddPicker) {
          e.preventDefault()
          e.stopPropagation()
          const r = zAddPicker.getBoundingClientRect()
          const vw = zAddPicker.ownerDocument.defaultView.innerWidth
          const vh = zAddPicker.ownerDocument.defaultView.innerHeight
          const width = Math.min(360, vw - 24)
          const height = Math.min(440, vh - 24)
          const left = Math.max(12, Math.min(r.right - width, vw - width - 12))
          const top = r.bottom + 6 + height <= vh - 12 ? r.bottom + 6 : Math.max(12, r.top - height - 6)
          setFlowAddAnchor({ left: left + 'px', top: top + 'px', width: width + 'px', maxHeight: height + 'px' })
          setFlowAddTargetSession('')
          setFlowTreeOpen(currentCwd ? { [currentCwd]: true } : {})
          setFlowAddPopup(true)
          setFlowUiNotice('')
          return
        }
        const zRoundFork = t && t.closest ? t.closest('[data-zoom-round-fork]') : null
        if (active === 'flow' && zRoundFork) {
          e.preventDefault()
          e.stopPropagation()
          executeZoomRoundFork(zRoundFork)
          return
        }
        if (active === 'flow' && zoomRelay) {
          const relayBtn = t && t.closest ? t.closest('[data-action="fzoom-relay"]') : null
          const board = flowBoardEl()
          const card = !relayBtn && board && board.contains(t) && t.closest ? t.closest('[data-sid]') : null
          if (card) {
            e.preventDefault()
            e.stopPropagation()
            const sid = card.getAttribute('data-sid') || ''
            if (sid) setZoomPick((cur) => (cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid]))
            return
          }
        }
        const el = t && t.closest ? t.closest('[data-action]') : null
        if (!el) return
        e.preventDefault()
        const act = el.getAttribute('data-action') || ''
        loadPanel(active, act, el)
      }

      function onPanelKeyDown(e) {
        if (!active || e.key !== 'Enter') return
        const t = e.target
        if (active === 'flow' && t && t.matches && t.matches('[data-zoom-prompt]') && !e.shiftKey) {
          e.preventDefault()
          executeZoomLaunch()
          return
        }
        if (!(t && t.matches && t.matches('[data-field]'))) return
        e.preventDefault()
        const box = panelRef.current
        const btn = box && box.querySelector('[data-action="query"], [data-action="query-record"]')
        if (btn) loadPanel(active, btn.getAttribute('data-action') || '', btn)
      }

      function onPanelInput(e) {
        const t = e.target
        if (t && t.matches && t.matches('[data-zoom-prompt]')) zoomPromptRef.current = String(t.value || '')
      }


      function onHeaderDown(e) {
        if (e.button !== 0) return
        e.preventDefault()
        let rect = null
        try { rect = e.currentTarget.parentElement.getBoundingClientRect() } catch (err) {}
        const baseX = rect ? rect.left : 0
        const baseY = rect ? rect.top : 0
        setPos({ x: baseX, y: baseY })
        setDockMode('float')
        setDrag({ startX: e.clientX, startY: e.clientY, baseX, baseY })
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
      }
      function onHeaderMove(e) {
        if (!drag) return
        const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
        let x = drag.baseX + e.clientX - drag.startX
        const near = vw - (x + curW()) < SNAP_THRESHOLD
        if (near) x = vw - curW()
        setSnapHint(near)
        setPos({ x, y: drag.baseY + e.clientY - drag.startY })
      }
      function onHeaderUp(e) {
        if (!drag) return
        const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
        const x = drag.baseX + e.clientX - drag.startX
        const near = vw - (x + curW()) < SNAP_THRESHOLD
        setDrag(null)
        setSnapHint(false)
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
        if (near) { setDockMode('right'); lsWrite({ dockMode: 'right' }) }
        else if (e.type === 'pointerup') lsWrite({ dockMode: 'float', pos: { x, y: drag.baseY + e.clientY - drag.startY } })
      }

      function onResizeStart(e, mode) {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        let rect = null
        try { rect = drawerRef.current.getBoundingClientRect() } catch (err) {}
        setResize({
          mode,
          startX: e.clientX,
          startY: e.clientY,
          baseW: rect ? rect.width : curW(),
          baseH: rect ? rect.height : (height || 560),
        })
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
      }
      function onResizeMove(e) {
        if (!resize) return
        const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
        const vh = e.currentTarget.ownerDocument.defaultView.innerHeight
        const maxW = Math.min(1400, vw - 24)
        const maxH = vh - 96
        if (resize.mode === 'left') {
          setWidth(clamp(resize.baseW + (resize.startX - e.clientX), MIN_W, maxW))
        } else if (resize.mode === 'right') {
          setWidth(clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW))
        } else if (resize.mode === 'bottom') {
          setHeight(clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH))
        } else if (resize.mode === 'corner') {
          setWidth(clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW))
          setHeight(clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH))
        }
      }
      function onResizeEnd(e) {
        if (resize && e.type === 'pointerup') {
          try {
            const vw = e.currentTarget.ownerDocument.defaultView.innerWidth
            const vh = e.currentTarget.ownerDocument.defaultView.innerHeight
            const maxW = Math.min(1400, vw - 24)
            const maxH = vh - 96
            const patch = {}
            if (resize.mode === 'left') patch.width = clamp(resize.baseW + (resize.startX - e.clientX), MIN_W, maxW)
            else if (resize.mode === 'right') patch.width = clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW)
            else if (resize.mode === 'bottom') patch.height = clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH)
            else if (resize.mode === 'corner') {
              patch.width = clamp(resize.baseW + (e.clientX - resize.startX), MIN_W, maxW)
              patch.height = clamp(resize.baseH + (e.clientY - resize.startY), MIN_H, maxH)
            }
            lsWrite(patch)
          } catch (err) {}
        }
        setResize(null)
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
      }

      if ((!embedded && sidebarActive) || !isOpen) return null

      const curW = () => width || 520

      const flowSessionGroups = (() => {
        const groups = new Map()
        for (const id of flowSessionIds) {
          const row = flowSessionRow(id) || {}
          const cwd = typeof row.cwd === 'string' && row.cwd ? row.cwd : 'Other sessions'
          if (!groups.has(cwd)) groups.set(cwd, [])
          groups.get(cwd).push({ id, row })
        }
        return [...groups.entries()].sort(([a], [b]) => {
          if (a === currentCwd) return -1
          if (b === currentCwd) return 1
          return a.localeCompare(b)
        }).map(([cwd, sessions]) => ({
          cwd,
          label: cwd === 'Other sessions' ? cwd : (cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd),
          sessions,
        }))
      })()

      const flowAddRound = (() => {
        const log = readFlowZoomLog()
        const runs = Array.isArray(log.runs) ? log.runs : []
        const run = runs.find((item) => item && item.id === log.activeId) || runs[runs.length - 1]
        if (!run || !Array.isArray(run.rounds) || !run.rounds.length) return null
        const round = run.rounds.find((item) => item && item.id === log.roundId) || run.rounds[run.rounds.length - 1]
        return round && Array.isArray(round.sids) ? round : null
      })()
      const flowAddMemberIds = flowAddRound ? flowAddRound.sids : []
      const flowAddWorkspaceCwd = flowAddMemberIds.length ? String((flowSessionRow(flowAddMemberIds[0]) || {}).cwd || '') : ''
      const flowAddGroups = flowSessionGroups.map((group) => ({
        ...group,
        sessions: group.sessions.filter(({ id }) => !flowAddMemberIds.includes(id)),
      })).filter((group) => group.sessions.length)
      const addSelectedFlowSession = async () => {
        if (!flowAddTargetSession || !flowAddRound || flowAddRound.sids.length >= 4 || typeof loadPanelRef.current !== 'function') return
        setFlowUiBusy(true); setFlowUiNotice('Adding to the current concurrent run…')
        try {
          await loadPanelRef.current('flow', 'fzoom-run-add', { dataset: { sid: flowAddTargetSession } }, { silent: true })
          setFlowAddPopup(false); setFlowAddTargetSession(''); setFlowUiNotice('Added to the current concurrent run')
        } catch (e) { setError('Failed to join the current concurrent run: ' + String((e && e.message) || e)) }
        finally { setFlowUiBusy(false) }
      }

      const flowZoomControl = active !== 'flow' || managing || flowBringPopup || flowAddPopup ? null : React.createElement('div', { className: 'tb-flow-zoom-float' + (flowSelectedSeqs.length ? ' with-selection' : '') },
        React.createElement('div', { className: 'tb-flow-zoom', title: 'Zoom the Flowglass canvas,without changing the header or scroll-area dimensions' },
          React.createElement('button', { type: 'button', className: 'tb-flow-zoom-btn', disabled: flowZoom <= 60, onClick: () => stepFlowZoom(-1) }, '−'),
          React.createElement('button', { type: 'button', className: 'tb-flow-zoom-value tb-flow-zoom-btn', title: 'Reset to 100%', onClick: () => setFlowZoomLevel(100) }, flowZoom + '%'),
          React.createElement('button', { type: 'button', className: 'tb-flow-zoom-btn', disabled: flowZoom >= 150, onClick: () => stepFlowZoom(1) }, '+'),
          React.createElement('button', {
            type: 'button', className: 'tb-flow-zoom-btn', title: flowZen ? 'Exit native Zen fullscreen (Esc)' : 'Enter native Zen fullscreen', onClick: toggleFlowZen,
          }, React.createElement('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            flowZen
              ? React.createElement('path', { d: 'M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4' })
              : React.createElement('path', { d: 'M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4' }),
          )),
        ),
      )

      const flowSelectionBar = active !== 'flow' || managing || !flowSelectedSeqs.length ? null : React.createElement('div', { className: 'tb-flow-selection-bar' },
        React.createElement('span', { className: 'tb-flow-selection-count', title: ' ' + flowSelectedSeqs.length + ' items' }, flowSelectedSeqs.length),
        React.createElement('button', {
          type: 'button', className: 'tb-flow-icon-btn', disabled: flowUiBusy,
          title: 'New session from selection: write only selected content to its draft without inheriting other history', onClick: createSelectedFlowSession,
        }, React.createElement('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          React.createElement('rect', { x: 2, y: 2.5, width: 9, height: 9, rx: 2 }),
          React.createElement('path', { d: 'M8.5 13.5h5v-5M11 11h2.5' }),
        )),
        React.createElement('button', {
          type: 'button', className: 'tb-flow-icon-btn', disabled: flowUiBusy,
          title: 'Addsession', onClick: () => { setFlowBringPopup(true); setFlowTreeOpen({}); setFlowUiNotice('') },
        }, React.createElement('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          React.createElement('path', { d: 'M2 4.5h7.5a3 3 0 0 1 3 3v4' }),
          React.createElement('path', { d: 'M4.5 2 2 4.5 4.5 7M10 10l2.5 2.5L15 10' }),
        )),
        React.createElement('button', {
          type: 'button', className: 'tb-flow-icon-btn', disabled: flowUiBusy,
          title: 'Clearselect', onClick: () => { setFlowSelectedSeqs([]); setFlowBringPopup(false) },
        }, React.createElement('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', 'aria-hidden': true },
          React.createElement('path', { d: 'M3.5 3.5l9 9M12.5 3.5l-9 9' }),
        )),
        flowUiBusy ? React.createElement('span', { className: 'tb-tab-spin' }) : null,
      )

      const flowBringDialog = active !== 'flow' || managing || !flowSelectedSeqs.length || !flowBringPopup ? null : React.createElement('div', { className: 'tb-flow-bring-popup' },
        React.createElement('div', { className: 'tb-flow-popup-head' },
          React.createElement('span', null, 'Addsession · ' + flowSelectedSeqs.length + ' items'),
          React.createElement('button', { type: 'button', className: 'tb-flow-icon-btn', title: 'disabled', onClick: () => setFlowBringPopup(false) }, '×'),
        ),
        React.createElement('div', { className: 'tb-flow-session-tree', role: 'tree', 'aria-label': 'Sessions grouped by workspace' },
          flowSessionGroups.map((group) => React.createElement('div', { className: 'tb-flow-tree-group', key: group.cwd, role: 'group' },
            React.createElement('button', {
              type: 'button', className: 'tb-flow-tree-workspace' + (flowTreeOpen[group.cwd] ? ' open' : ''), title: group.cwd,
              'aria-expanded': Boolean(flowTreeOpen[group.cwd]),
              onClick: () => setFlowTreeOpen((cur) => ({ ...cur, [group.cwd]: !cur[group.cwd] })),
            },
              React.createElement('svg', { className: 'tb-flow-tree-folder', viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
                React.createElement('path', { d: 'M1.8 4.2h4l1.3 1.5h7.1v6.6a1.3 1.3 0 0 1-1.3 1.3H3.1a1.3 1.3 0 0 1-1.3-1.3z' }),
                React.createElement('path', { d: 'M1.8 5.7V3.8a1.3 1.3 0 0 1 1.3-1.3h2.7l1.3 1.7h5.8a1.3 1.3 0 0 1 1.3 1.3v.2' }),
              ),
              React.createElement('span', { className: 'tb-flow-tree-label' }, group.label),
              React.createElement('span', { className: 'tb-flow-tree-count' }, group.sessions.length),
              React.createElement('span', { className: 'tb-flow-tree-chevron', 'aria-hidden': true }, '▶'),
            ),
            flowTreeOpen[group.cwd] ? group.sessions.map(({ id, row }) => {
              const label = row && (row.displayTitle || row.title) ? (row.displayTitle || row.title) : id
              return React.createElement('button', {
                type: 'button', role: 'treeitem', key: id,
                className: 'tb-flow-tree-session' + (flowTargetSession === id ? ' on' : ''),
                'aria-selected': flowTargetSession === id,
                title: label + '\n' + id,
                onClick: () => setFlowTargetSession(id),
              }, React.createElement('span', null, label), React.createElement('span', { className: 'tb-flow-tree-id' }, String(id).replace(/^session-/, '').slice(0, 8)))
            }) : null,
          )),
        ),
        flowUiNotice ? React.createElement('div', { className: 'tb-flow-toolbar-note', title: flowUiNotice }, flowUiNotice) : null,
        React.createElement('div', { className: 'tb-flow-popup-actions' },
          React.createElement('button', { type: 'button', className: 'tb-flow-select-btn', disabled: flowUiBusy, onClick: () => setFlowBringPopup(false) }, 'Cancel'),
          React.createElement('button', { type: 'button', className: 'tb-flow-select-btn', disabled: flowUiBusy || !flowTargetSession, title: 'Appendtotargetsessiondraft,notAutoSend', onClick: sendSelectedFlow }, 'Adddraft'),
        ),
      )

      const flowAddDialog = active !== 'flow' || managing || !flowAddPopup ? null : React.createElement('div', { className: 'tb-flow-bring-popup tb-flow-add-popup', style: flowAddAnchor || undefined },
        React.createElement('div', { className: 'tb-flow-popup-head' },
          React.createElement('span', null, 'Add toCurrent concurrent run · ' + flowAddMemberIds.length + ' session'),
          React.createElement('button', { type: 'button', className: 'tb-flow-icon-btn', title: 'disabled', onClick: () => setFlowAddPopup(false) }, '×'),
        ),
        React.createElement('div', { className: 'tb-flow-session-tree', role: 'tree', 'aria-label': 'Select sessions to add to the concurrent run, grouped by workspace' },
          flowAddGroups.map((group) => {
            const sameWorkspace = !flowAddWorkspaceCwd || group.cwd === flowAddWorkspaceCwd
            return React.createElement('div', { className: 'tb-flow-tree-group', key: group.cwd, role: 'group' },
              React.createElement('button', {
                type: 'button', className: 'tb-flow-tree-workspace' + (flowTreeOpen[group.cwd] ? ' open' : ''), title: group.cwd,
                'aria-expanded': Boolean(flowTreeOpen[group.cwd]),
                onClick: () => setFlowTreeOpen((cur) => ({ ...cur, [group.cwd]: !cur[group.cwd] })),
              },
                React.createElement('svg', { className: 'tb-flow-tree-folder', viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
                  React.createElement('path', { d: 'M1.8 4.2h4l1.3 1.5h7.1v6.6a1.3 1.3 0 0 1-1.3 1.3H3.1a1.3 1.3 0 0 1-1.3-1.3z' }),
                  React.createElement('path', { d: 'M1.8 5.7V3.8a1.3 1.3 0 0 1 1.3-1.3h2.7l1.3 1.7h5.8a1.3 1.3 0 0 1 1.3 1.3v.2' }),
                ),
                React.createElement('span', { className: 'tb-flow-tree-label' }, group.label),
                React.createElement('span', { className: 'tb-flow-tree-count' }, group.sessions.length),
                React.createElement('span', { className: 'tb-flow-tree-chevron', 'aria-hidden': true }, '▶'),
              ),
              flowTreeOpen[group.cwd] ? group.sessions.map(({ id, row }) => {
                const label = row && (row.displayTitle || row.title) ? (row.displayTitle || row.title) : id
                return React.createElement('button', {
                  type: 'button', role: 'treeitem', key: id, disabled: !sameWorkspace, draggable: sameWorkspace,
                  className: 'tb-flow-tree-session' + (flowAddTargetSession === id ? ' on' : ''),
                  'aria-selected': flowAddTargetSession === id,
                  title: sameWorkspace ? label + '\n' + id : label + '\nOutside the current concurrent workspace',
                  onClick: () => { if (sameWorkspace) setFlowAddTargetSession(id) },
                  onDragStart: sameWorkspace ? (e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', id) } : undefined,
                }, React.createElement('span', null, label), React.createElement('span', { className: 'tb-flow-tree-id' }, String(id).replace(/^session-/, '').slice(0, 8)))
              }) : null,
            )
          }),
        ),
        flowUiNotice ? React.createElement('div', { className: 'tb-flow-toolbar-note', title: flowUiNotice }, flowUiNotice) : null,
        React.createElement('div', { className: 'tb-flow-popup-actions' },
          React.createElement('button', { type: 'button', className: 'tb-flow-select-btn', disabled: flowUiBusy, onClick: () => setFlowAddPopup(false) }, 'Cancel'),
          React.createElement('button', { type: 'button', className: 'tb-flow-select-btn', disabled: flowUiBusy, onClick: () => Promise.resolve(executeZoomAddNewSession()).then(() => setFlowAddPopup(false)) }, 'CreateAdd'),
          React.createElement('button', { type: 'button', className: 'tb-flow-select-btn', disabled: flowUiBusy || !flowAddTargetSession, onClick: addSelectedFlowSession }, 'Addbranch'),
        ),
      )

      const zoomActionBar = active !== 'flow' || managing || !(zoomRelay || zoomPick.length) ? null : React.createElement('div', { className: 'tb-flow-selection-bar' },
        zoomRelay ? React.createElement('span', { className: 'tb-flow-zoom-relay-src', title: 'Source session:' + zoomRelay.source }, '⇪ ' + String(zoomRelay.source).replace(/^session-/, '').slice(0, 8)) : null,
        React.createElement('span', { className: 'tb-flow-selection-count', title: ' ' + zoomPick.length + ' target sessions' }, zoomPick.length),
        React.createElement('button', { type: 'button', className: 'tb-flow-select-btn', disabled: flowUiBusy, title: 'Append content to the target session input draft (notAutoSend)', onClick: () => executeZoomCast(false) }, 'Adddraft'),
        React.createElement('button', { type: 'button', className: 'tb-flow-select-btn', disabled: flowUiBusy, title: 'Send directly to target sessions (queue when busy and start immediately when idle)', onClick: () => executeZoomCast(true) }, 'Send directly'),
        React.createElement('button', { type: 'button', className: 'tb-flow-select-btn', disabled: flowUiBusy, onClick: () => { setZoomPick([]); setZoomRelay(null); setFlowUiNotice('') } }, 'Clear'),
        flowUiBusy ? React.createElement('span', { className: 'tb-tab-spin' }) : null,
        flowUiNotice ? React.createElement('span', { className: 'tb-flow-toolbar-note', title: flowUiNotice }, flowUiNotice) : null,
      )

      const themeButton = !themeSvc ? null : React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: themeScheme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
        'aria-label': 'Toggle light/dark theme',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); toggleTheme() },
      },
        themeScheme === 'dark'
          ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' },
              React.createElement('circle', { cx: 7, cy: 7, r: 2.6 }),
              React.createElement('path', { d: 'M7 1.2v1.4M7 11.4v1.4M1.2 7h1.4M11.4 7h1.4M2.9 2.9l1 1M10.1 10.1l1 1M11.1 2.9l-1 1M3.9 10.1l-1 1' }),
            )
          : React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' },
              React.createElement('path', { d: 'M12.2 8.7A5.2 5.2 0 1 1 5.3 1.8a4.4 4.4 0 0 0 6.9 6.9z' }),
            ),
      )

      const pipButton = !pipSupported ? null : React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: 'Picture in Picture: place the toolbox in a separate window (detached from the main window and draggable anywhere)',
        'aria-label': 'Picture in Picture',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); openPip() },
      },
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 },
          React.createElement('rect', { x: 1.5, y: 3, width: 11, height: 8, rx: 1 }),
          React.createElement('rect', { x: 7.5, y: 7, width: 3.6, height: 2.8, rx: 0.5, fill: 'currentColor', stroke: 'none' }),
        ),
      )

      const gearButton = RT.capabilities.managePlugins === false ? null : React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: managing ? 'Return to the tool panel' : 'Manage plugins (Stop/Start)',
        'aria-label': 'Manage plugins',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); const next = !managing; setManaging(next); if (next) { refreshPlugins(); loadRebuildHistory(); loadAiUsage() } },
      },
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' },
          React.createElement('path', { d: 'M1.8 4.2h10.4M1.8 9.8h10.4' }),
          React.createElement('circle', { cx: 9.2, cy: 4.2, r: 1.6 }),
          React.createElement('circle', { cx: 4.8, cy: 9.8, r: 1.6 }),
        ),
      )

      const dockButton = RT.bundleId === 'flowglass-en' ? null : React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: dockMode === 'right' ? 'Switch to three-column docking (resize the chat area into left, center, and right columns)' : dockMode === 'full' ? 'Switch to floating mode' : 'Dock to the right',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => {
          ev.stopPropagation()
          setDockMode(dockMode === 'right' ? 'full' : dockMode === 'full' ? 'float' : 'right')
        },
      },
        dockMode === 'right'
          ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'currentColor' },
              React.createElement('rect', { x: 2.5, y: 2.5, width: 8, height: 8, rx: 1 }),
              React.createElement('rect', { x: 5.5, y: 5.5, width: 6, height: 6, rx: 1, opacity: 0.55 }),
            )
          : dockMode === 'full'
            ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'currentColor' },
                React.createElement('rect', { x: 1.5, y: 2, width: 2.6, height: 10, rx: 0.8, opacity: 0.35 }),
                React.createElement('rect', { x: 5.1, y: 2, width: 5, height: 10, rx: 0.8, opacity: 0.55 }),
                React.createElement('rect', { x: 11.1, y: 2, width: 1.6, height: 10, rx: 0.5 }),
              )
            : React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'currentColor' },
                React.createElement('rect', { x: 2, y: 2, width: 7, height: 10, rx: 1 }),
                React.createElement('rect', { x: 10.5, y: 5, width: 2.5, height: 7, rx: 0.5, opacity: 0.55 }),
              ),
      )

      const closeButton = React.createElement('button', {
        type: 'button',
        className: 'jr-overlay-close',
        title: 'disabled',
        'aria-label': 'disabled',
        onPointerDown: (ev) => ev.stopPropagation(),
        onClick: (ev) => { ev.stopPropagation(); if (pipOn) setMainHidden(true); else store.close() },
      },
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
          React.createElement('path', { d: 'M2 2l10 10M12 2L2 12' }),
        ),
      )

      const handles = []
      if (!embedded && (dockMode === 'right' || dockMode === 'full')) {
        handles.push(React.createElement('div', {
          key: 'resize-left',
          className: 'jr-resize-left',
          title: 'Drag to resize width',
          onPointerDown: (e) => onResizeStart(e, 'left'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
      } else if (!embedded && dockMode === 'float') {
        handles.push(React.createElement('div', {
          key: 'resize-right',
          className: 'jr-resize-right',
          title: 'Drag to resize width',
          onPointerDown: (e) => onResizeStart(e, 'right'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
        handles.push(React.createElement('div', {
          key: 'resize-bottom',
          className: 'jr-resize-bottom',
          title: 'Drag to resize height',
          onPointerDown: (e) => onResizeStart(e, 'bottom'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
        handles.push(React.createElement('div', {
          key: 'resize-corner',
          className: 'jr-resize-corner',
          title: 'Drag to resize',
          onPointerDown: (e) => onResizeStart(e, 'corner'),
          onPointerMove: onResizeMove,
          onPointerUp: onResizeEnd,
          onPointerCancel: onResizeEnd,
        }))
      }

      const style = {}
      if (!embedded && (dockMode === 'right' || dockMode === 'full') && width) style.width = width + 'px'
      if (!embedded && dockMode === 'full' && !width) style.width = '560px'
      if (!embedded && mainHidden) { style.visibility = 'hidden'; style.pointerEvents = 'none' }
      if (!embedded && dockMode === 'float') {
        if (height) style.height = height + 'px'
        if (pos) {
          style.left = pos.x + 'px'
          style.top = pos.y + 'px'
        }
      }

      const pickCat = (id) => {
        if (id === cat) return
        const next = Object.assign({}, activeByCat)
        if (active) next[cat] = active
        setActiveByCat(next)
        setCat(id)
        lsWrite({ cat: id, activeByCat: next })
        const inCat = tools.filter((t) => catOf(t.id) === id)
        const remembered = next[id]
        const target = remembered && inCat.some((t) => t.id === remembered) ? remembered : (inCat.length ? inCat[0].id : null)
        setActive(target)
        lastNav = { cat: id, active: target }
      }
      const moveNode = (id, toCat) => {
        if (!id || !toCat) return
        if (catOf(id) === toCat) return
        const next = Object.assign({}, catOverrides)
        next[id] = toCat
        setCatOverrides(next)
        catsWrite({ overrides: next })
      }
      const toggleCat = (id) => {
        const next = Object.assign({}, collapsedCats)
        next[id] = !next[id]
        setCollapsedCats(next)
        catsWrite({ collapsed: next })
      }

      const tabFilterLc = tabFilter.trim().toLowerCase()
      const searching = tabFilterLc.length > 0
      const catCounts = {}
      for (const t of tools) { const c = catOf(t.id); catCounts[c] = (catCounts[c] || 0) + 1 }
      const visibleCats = TOOL_CATS.filter((c) => (catCounts[c.id] || 0) > 0)
      const effCat = (catCounts[cat] || 0) > 0 ? cat : (visibleCats.length ? visibleCats[0].id : cat)
      const shownTools = searching
        ? tools.filter((t) => (String(t.label) + ' ' + String(t.id)).toLowerCase().indexOf(tabFilterLc) >= 0)
        : tools.filter((t) => catOf(t.id) === effCat)
      const toolButton = (t) => React.createElement('button', {
        key: t.id,
        type: 'button',
        className: 'tb-tab' + (t.id === active ? ' tb-tab-active' : ''),
        title: t.label + ' (' + (TOOL_CATS.find((c) => c.id === catOf(t.id)) || {}).label + ')',
        onClick: () => { setActive(t.id); lastNav = { cat: catOf(t.id), active: t.id } },
      }, t.label,
        tabBadges[t.id] ? React.createElement('span', { className: 'tb-tab-badge' }, tabBadges[t.id]) : null,
        t.id === busyTool ? React.createElement('span', { className: 'tb-tab-spin' }) : null)

      let body = null
      if (managing) {
        body = React.createElement('div', { className: 'tb-frame' },
          React.createElement('div', { className: 'tb-pane' },
            React.createElement('div', { className: 'tb-pane-head' },
              error ? React.createElement('div', { className: 'tb-error' }, String(error)) : null,
              copied ? React.createElement('div', { className: 'tb-banner tb-banner-info' }, String(copied)) : null,
              React.createElement('div', { className: 'tb-row' },
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn tb-btn-primary',
                  disabled: rebuilding,
                  title: canRebuildFromDisk ? undefined : 'Compiled bundle: restore define/run from the embedded manifest without disk access',
                  onClick: runRebuild,
                }, rebuilding ? 'Rebuilding…' : (canRebuildFromDisk ? 'Rebuild/restore from plugins.json' : 'Restore compiled manifest')),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn',
                  onClick: () => toggleAll(true),
                }, 'Start all'),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn',
                  title: 'Rerun all running host-only plugins (apply changes to multiple tools at once;leave stopped plugins unchanged)',
                  onClick: restartAll,
                }, 'Rerun all'),
                React.createElement('button', {
                  type: 'button',
                  className: 'tb-btn tb-btn-ghost',
                  title: 'Hide all headless host-only tools,show only plugins with a UI;click again to restore',
                  onClick: () => toggleAll(false),
                }, 'Stop all'),
                panelHideSupported ? React.createElement('button', {
                  type: 'button',
                  className: 'tb-chip' + (hideHostOnly ? ' tb-chip-on' : ''),
                  title: 'Hide headless host-only plugins in the lower-left Cordis panel (the management list is unaffected);highlighted means hidden; click again to restore' + (hideHostOnly ? ';currently hidden ' + panelHide.headless.size + ' ' : ''),
                  onClick: () => { const nv = !hideHostOnly; setHideHostOnly(nv); setPanelHideOn(nv) },
                }, 'HideCordisPlugin') : null,
                React.createElement('input', {
                  className: 'tb-input',
                  style: { flex: '1', minWidth: '120px' },
                  placeholder: 'Filter plugins by name / ID',
                  value: pluginFilter,
                  onChange: (e) => setPluginFilter(e.target.value),
                }),
              ),
              React.createElement('div', { className: 'tb-note', style: { marginTop: '2px' } },
                React.createElement('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'Appearance (Theme / accent / font size,)'),
                React.createElement(AppearancePanel, null)),
              rebuildLines
                ? React.createElement('div', { className: 'tb-note' }, rebuildLines.map((l, i) => React.createElement('div', { key: i }, l)))
                : null,
              rebuildHistory.length && canRebuildFromDisk
                ? (() => {
                    const max = Math.max.apply(null, rebuildHistory.map((h) => h.ms || 0).concat([1]))
                    return React.createElement('div', { className: 'tb-note' },
                      'RebuildElapsed (latest ' + rebuildHistory.length + ' runs,hover for details;red = has failures)',
                      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '36px', marginTop: '6px' } },
                        rebuildHistory.map((h, i) => React.createElement('div', {
                          key: i,
                          title: (h.at || '') + ' · ' + (h.ms == null ? '—' : h.ms + 'ms') + ' · defined ' + h.defined + ' / Start ' + h.started + ' / disabled ' + h.suppressed + ' / failed ' + h.failed,
                          style: {
                            width: '10px',
                            height: Math.max(2, Math.round(((h.ms || 0) / max) * 32)) + 'px',
                            borderRadius: '2px',
                            background: h.failed > 0 ? 'var(--tb-danger,#d94f4f)' : 'var(--tb-accent,#3f6fd9)',
                            opacity: 0.85,
                          },
                        }))))
                  })()
                : null,
              aiUsage && canAiUsage && aiUsage.totals && aiUsage.totals.calls
                ? React.createElement('div', { className: 'tb-note' },
                    'AI usage (latest 100 ):total ' + aiUsage.totals.calls + ' runs · output ' + aiUsage.totals.out + ' tok' + (aiUsage.totals.errors ? ' · failed ' + aiUsage.totals.errors + ' runs' : '') + (aiUsage.totals.todayCalls ? ';today ' + aiUsage.totals.todayCalls + ' runs / ' + aiUsage.totals.todayOut + ' tok' : ''),
                    React.createElement('div', { className: 'tb-pills', style: { marginTop: '4px' } },
                      aiUsage.tools.map((t) => React.createElement('span', {
                        key: t.tool,
                        className: 'tb-pill tb-pill-plain',
                        title: t.tool + ':succeeded ' + t.calls + ' runs · output ' + t.out + ' tok' + (t.errors ? ' · failed ' + t.errors + ' runs' : ''),
                      }, t.tool + ' ' + t.calls + '/' + (t.out >= 10000 ? (t.out / 1000).toFixed(1) + 'k' : t.out) + ' tok')),
                      React.createElement('button', {
                        type: 'button',
                        className: 'tb-btn tb-btn-sm tb-btn-ghost',
                        title: 'Copy CSV (tool,calls,output_tokens,errors)',
                        onClick: async () => {
                          if (!aiUsage || !Array.isArray(aiUsage.tools)) return
                          const csv = ['tool,calls,output_tokens,errors']
                            .concat(aiUsage.tools.map((t) => [t.tool, t.calls, t.out, t.errors].join(',')))
                            .join('\n')
                          try {
                            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                              await navigator.clipboard.writeText(csv)
                              setCopied('Ledger CSV copied (' + aiUsage.tools.length + ' tools)')
                            } else setCopied('The Clipboard API is unavailable in this environment')
                          } catch (e) { setCopied('Copy failed: ' + String((e && e.message) || e)) }
                        },
                      }, 'Copy CSV')))
                : null,
              React.createElement('div', { className: 'tb-note' }, canRebuildFromDisk
                ? 'The switch actually stops or starts the plugin (equivalent to stop/run in the Cordis panel; both states stay synchronized),and saves the startup state .dsh-dynamic-toolbox/toolbox-plugins.json;"restartafter"pill = default state for the next rebuild,click to change only the saved state without affecting the current state.Tabs disappear after stopping,and remount about 0.5s after starting.Manage plugins with a client half in the Cordis panel.'
                : 'The switch actually stops or starts the plugin (equivalent to stop/run in the Cordis panel; both states stay synchronized),thissaved startup state;"restartafter"pill = default state for the next startup,click to change only the saved state without affecting the current state.Tabs disappear after stopping,and remount about 0.5s after starting.Manage plugins with a client half in the Cordis panel.'),
            ),
            React.createElement('div', { className: 'tb-pane-body tb-pane-col' },
              (() => {
                const visiblePlugins = plugins
                if (visiblePlugins.length === 0) {
                  return React.createElement('div', { className: 'tb-notice' }, 'No dynamic plugins')
                }
                const manageRow = (p) =>
                      React.createElement('div', {
                        key: p.pluginId,
                        className: 'tb-manage-row',
                        draggable: Boolean(p.entryId),
                        onDragStart: (e) => {
                          if (!p.entryId) return
                          setDragId(p.entryId)
                          try { if (e.dataTransfer) e.dataTransfer.setData('text/plain', p.entryId) } catch (err) {}
                        },
                        onDragEnd: () => setDragId(null),
                      },
                        p.entryId ? React.createElement('span', { className: 'tb-drag', title: 'dragtoCategory' }, '⋮⋮') : null,
                        React.createElement('div', { className: 'tb-manage-main' },
                          React.createElement('span', { className: 'tb-manage-label' }, p.name),
                          React.createElement('span', { className: 'tb-manage-id' }, p.pluginId + (p.currentPackageId ? ' · ' + p.currentPackageId : '') + (p.entryId ? ' · ' + p.entryId : '')),
                        ),
                        React.createElement('span', { className: 'tb-pill ' + (p.running ? 'tb-pill-done' : 'tb-pill-todo') }, p.running ? 'Running' : 'Stop'),
                        p.defaultStart != null
                          ? React.createElement('button', {
                            type: 'button',
                            className: 'tb-pill-btn' + (p.defaultStart ? ' on' : ''),
                            title: 'default state for the next rebuild (saved startup state)——clickswitch;only,notCurrent run',
                            onClick: () => setDefaultPlugin(p),
                          }, p.defaultStart ? 'Start after restart' : 'Keep disabled after restart')
                          : null,
                        React.createElement('button', {
                          type: 'button',
                          className: 'tb-btn tb-btn-sm tb-btn-ghost',
                          title: p.hasClientHalf ? 'includes a client half,to Cordis paneloperation' : 'Rerun (from,code)',
                          disabled: Boolean(p.hasClientHalf),
                          style: p.hasClientHalf ? { opacity: 0.4, cursor: 'default' } : null,
                          onClick: () => restartPlugin(p),
                        }, 'Rerun'),
                        React.createElement('button', {
                          type: 'button',
                          className: 'tb-switch' + (p.running ? ' tb-switch-on' : ''),
                          title: p.hasClientHalf ? 'includes a client half,to Cordis paneloperation'
                            : p.running ? (p.canStop === false ? 'This DSH version lacks stopFromPanel and cannot stop this plugin' : 'Stop this plugin')
                            : 'Start this plugin',
                          disabled: Boolean(p.hasClientHalf) || (p.running && p.canStop === false),
                          style: (p.hasClientHalf || (p.running && p.canStop === false)) ? { opacity: 0.4, cursor: 'default' } : null,
                          onClick: () => togglePlugin(p),
                        }),
                      )
                    const fq = pluginFilter.trim().toLowerCase()
                    if (fq) {
                      return React.createElement('div', { className: 'tb-manage-list' }, visiblePlugins
                        .filter((p) => (p.name || '').toLowerCase().indexOf(fq) >= 0 || (p.pluginId || '').toLowerCase().indexOf(fq) >= 0)
                        .map(manageRow))
                    }
                    const byCat = {}
                    for (const p of visiblePlugins) {
                      const cid = p.entryId ? catOf(p.entryId) : 'system'
                      if (!byCat[cid]) byCat[cid] = []
                      byCat[cid].push(p)
                    }
                    const chevron = React.createElement('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'currentColor' },
                      React.createElement('path', { d: 'M3 1.5 L7.5 5 L3 8.5 Z' }))
                    return React.createElement('div', null, TOOL_CATS
                      .filter((c) => byCat[c.id] && byCat[c.id].length)
                      .map((c) => {
                        const list = byCat[c.id]
                        const open = !collapsedCats[c.id]
                        const running = list.filter((p) => p.running).length
                        return React.createElement('div', { key: 'cat-' + c.id },
                          React.createElement('div', {
                            className: 'tb-tree-cat' + (open ? ' tb-tree-cat-open' : '') + (dragId && catOf(dragId) !== c.id ? ' tb-tree-cat-drop' : ''),
                            title: 'clickcollapse/expand;drag a node onto this heading to change its category (and)',
                            onClick: () => toggleCat(c.id),
                            onDragOver: (e) => { if (dragId) e.preventDefault() },
                            onDrop: (e) => { e.preventDefault(); if (dragId) moveNode(dragId, c.id); setDragId(null) },
                          },
                            React.createElement('span', { className: 'tb-tree-chev' }, chevron),
                            React.createElement('span', { className: 'tb-tree-cat-label' }, c.label),
                            React.createElement('span', { className: 'tb-note' }, list.length + '  · ' + running + ' run'),
                          ),
                          open ? React.createElement('div', { className: 'tb-tree-kids' }, list.map(manageRow)) : null,
                        )
                      }))
                  })()),
          ),
        )
      } else if (tools.length === 0) {
        body = currentCwd
          ? React.createElement('div', { className: 'tb-empty' },
              canRebuildFromDisk
                ? 'dsh-dynamic-toolbox was not detected in the current workspace\nSwitch to a workspace containing the toolbox to load it automatically;Tools are hidden in this workspace'
                : 'This toolbox bundle is not mounted in the current workspace\nSwitch to a valid workspace to load it automatically;Tools are hidden in this workspace',
            )
          : React.createElement('div', { className: 'tb-empty' },
              'No tools available\nRunning tool plugins such as Jira will make them appear here automatically;Stopped plugins can be restarted from the management button',
            )
      } else {
        body = React.createElement('div', { className: 'tb-frame', ref: panelRef, onClick: onPanelClick, onKeyDown: onPanelKeyDown, onInput: onPanelInput, onPointerDown: onFlowRailResizeDown },
          error ? React.createElement('div', { className: 'tb-error' }, String(error)) : null,
          copied ? React.createElement('div', { className: 'tb-banner tb-banner-info' }, String(copied)) : null,
          active === 'flow' && flowUiNotice ? React.createElement('div', { className: 'tb-banner tb-banner-info', title: flowUiNotice }, String(flowUiNotice)) : null,
          html
            ? React.createElement('div', { className: 'tb-panel-html', dangerouslySetInnerHTML: { __html: html } })
            : React.createElement('div', { className: 'tb-notice' }, 'Loading panel…'),
          flowZoomControl,
          flowSelectionBar,
          flowBringDialog,
          flowAddDialog,
          zoomActionBar,
          showJumpLatest ? React.createElement('button', {
            type: 'button',
            className: 'tb-jump-latest',
            title: 'Smoothly scroll to the latest content in this panel',
            onClick: jumpToLatest,
          }, '↓ Jump to latest') : null,
        )
      }

      const drawerEl = React.createElement('div', {
        ref: drawerRef,
        className: (embedded
          ? 'jr-drawer jr-drawer-embedded'
          : 'jr-drawer' + (dockMode === 'right' ? ' jr-docked' : dockMode === 'full' ? ' jr-docked-full' : ''))
          + (flowZen && active === 'flow' ? ' jr-flow-zen' : ''),
        'data-dsh-toolbox-root': RT.bundleId,
        style,
      },
        embedded ? null : React.createElement('div', {
          className: 'jr-drawer-header',
          style: RT.bundleId === 'flowglass-en' ? { cursor: 'default' } : undefined,
          onPointerDown: RT.bundleId === 'flowglass-en' ? undefined : onHeaderDown,
          onPointerMove: RT.bundleId === 'flowglass-en' ? undefined : onHeaderMove,
          onPointerUp: RT.bundleId === 'flowglass-en' ? undefined : onHeaderUp,
          onPointerCancel: RT.bundleId === 'flowglass-en' ? undefined : onHeaderUp,
        },
          React.createElement('span', {
            className: 'jr-drawer-title',
            title: fullDisplayName + (managing ? ' · Manage' : ''),
          }, managing ? compactDisplayName + ' · Manage' : compactDisplayName),
          themeButton,
          pipButton,
          gearButton,
          dockButton,
          closeButton,
        ),
        managing || tools.length === 1 ? null : React.createElement('div', { className: 'tb-nav' },
          React.createElement('input', {
            className: 'tb-input tb-nav-search',
            placeholder: 'Searchtool (total ' + tools.length + ' ,matches name / ID)',
            value: tabFilter,
            onChange: (e) => setTabFilter(e.target.value),
          }),
          React.createElement(HRow, { className: 'tb-hrow tb-cats' },
            visibleCats.map((c) => React.createElement('button', {
              key: c.id,
              type: 'button',
              className: 'tb-chip' + (!searching && c.id === effCat ? ' tb-chip-on' : ''),
              title: 'Category"' + c.label + '";Manage (Managebutton)cantoCategory',
              onClick: () => pickCat(c.id),
            }, c.label + ' · ' + catCounts[c.id]))),
          React.createElement(HRow, { className: 'tb-hrow tb-tools' },
            shownTools.length
              ? shownTools.map(toolButton)
              : React.createElement('span', { className: 'tb-hrow-empty' }, searching ? 'No matching tools' : 'This category has no running tools')),
        ),
        React.createElement('div', { className: 'jr-drawer-body' }, body),
        handles,
      )

      const flowMarkdownPortalEl = flowMarkdownPortal && flowMarkdownText && flowCreatePortal
        ? flowCreatePortal(React.createElement('div', { className: 'fl-markdown-rendered' },
          React.createElement(flowMarkdownText, {
            text: flowMarkdownPortal.text,
            streaming: flowMarkdownPortal.streaming,
            labels: FLOW_MARKDOWN_LABELS,
            codeLabels: FLOW_MARKDOWN_LABELS.code,
          }),
        ), flowMarkdownPortal.mount || flowMarkdownPortal.target)
        : null
      const drawerWithPortal = React.createElement(React.Fragment, null, drawerEl, flowMarkdownPortalEl)

      if (embedded) {
        return React.createElement('div', {
          'data-dsh-toolbox-scope': RT.domValue(),
          style: { display: 'flex', width: '100%', height: '100%', minHeight: 0 },
        }, drawerWithPortal)
      }

      const overlay = React.createElement(React.Fragment, null,
        drawerWithPortal,
        snapHint ? React.createElement('div', { className: 'jr-snap-indicator' }) : null,
        resize ? React.createElement('div', { className: 'jr-resize-badge' },
          Math.round(width || 520) + ' × ' + (height ? Math.round(height) : 'Auto'),
        ) : null,
      )
      return RT.bundleId === 'dynamic' ? overlay : React.createElement('div', {
        'data-dsh-toolbox-scope': RT.domValue(),
        style: { display: 'contents' },
      }, overlay)
    }

    function FlowglassSidebarView(props) {
      const active = useIntegrationActive()
      if (!active) {
        return React.createElement('div', {
          'data-dsh-toolbox-scope': RT.domValue(),
          style: { width: '100%', height: '100%' },
        }, React.createElement('div', { className: 'tb-notice' }, 'The Flowglass right-sidebar host is currently unavailable.'))
      }
      return React.createElement(Drawer, {
        embedded: true,
        visible: props.visible,
        sessionId: props.scope && props.scope.sessionId,
        cwd: props.scope && props.scope.cwd,
        useSessions: () => undefined,
      })
    }

    function FlowglassNativeTabBody(props) {
      const info = props.useTabInfo()
      const visible = !(info && info.tab && info.tab.visible === false)
      const useSessions = typeof props.useSessions === 'function' ? props.useSessions : () => undefined
      const selectedSessionId = useSessions((state) => state && state.current ? String(state.current) : '')
      const boundSessionId = String(props.sessionId || '')
      if (visible) {
        nativeFlowVisible = true
        nativeFlowReopenSession = ''
      } else if (nativeFlowVisible && selectedSessionId && boundSessionId && selectedSessionId !== boundSessionId) {
        nativeFlowReopenSession = selectedSessionId
      } else if (nativeFlowReopenSession !== boundSessionId) {
        nativeFlowVisible = false
      }
      return React.createElement(Drawer, {
        embedded: true,
        visible,
        sessionId: props.sessionId,
        useSessions,
        useWorkspaces: typeof props.useWorkspaces === 'function' ? props.useWorkspaces : () => undefined,
      })
    }

    function ToolboxNativeTabBody(props) {
      const info = props.useTabInfo()
      const visible = !(info && info.tab && info.tab.visible === false)
      const useSessions = typeof props.useSessions === 'function' ? props.useSessions : () => undefined
      return React.createElement(Drawer, {
        embedded: true,
        visible,
        sessionId: props.sessionId,
        useSessions,
        useWorkspaces: typeof props.useWorkspaces === 'function' ? props.useWorkspaces : () => undefined,
      })
    }

    if (!OFFICIAL_TOOLBOX_ONLY && typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
      ctx.effect(() => mountSidebarEntry())
    } else if (!OFFICIAL_TOOLBOX_ONLY) {
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: RT.slot('entry'), order: -1000, label: RT.displayName },
        (props) => React.createElement(Entry, { wide: Boolean(props.wide) }),
      ))
    }

    if (!OFFICIAL_TOOLBOX_ONLY) {
      slots.inject('shell.overlay', () => slots.register(
        {
          name: 'shell.overlay',
          id: RT.slot('drawer'),
          order: 120,
          label: RT.displayName + 'drawer',
        },
        (props) => React.createElement(Drawer, props),
      ))
    }

    if (RT.bundleId === 'flowglass-en') {
      slots.inject('plugins.bundle.config', () => slots.register(
        { name: 'plugins.bundle.config', key: 'dsh-flowglass-en' },
        () => React.createElement(FlowglassPluginSettings, null),
      ))
      slots.inject('settings.plugins.tab', () => slots.register(
        {
          name: 'settings.plugins.tab',
          id: 'flowglass',
          order: 20,
          label: () => 'Flowglass',
        },
        () => React.createElement('div', { style: { padding: '16px 20px', overflowY: 'auto' } },
          React.createElement(FlowglassPluginSettings, null)
        ),
      ))
      slots.inject('settings.section', () => slots.register(
        {
          name: 'settings.section',
          id: 'flowglass',
          order: 35,
          label: () => 'Flowglass',
        },
        () => React.createElement('div', { style: { padding: '16px 20px', overflowY: 'auto' } },
          React.createElement(FlowglassPluginSettings, null)
        ),
      ))
    }

    if ((RT.bundleId === 'flowglass-en' || OFFICIAL_TOOLBOX_ONLY) && typeof ctx.inject === 'function') {
      ctx.inject(['sidebarRightTabs', 'sidebarRight'], (nativeCtx) => {
        const tabs = nativeCtx.get('sidebarRightTabs')
        if (!tabs || typeof tabs.register !== 'function') return
        const controller = nativeCtx.get('sidebarRight')
        const flowGlyph = (p) => React.createElement('svg', {
          width: (p && p.size) || 16, height: (p && p.size) || 16, viewBox: '0 0 16 16', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
          className: p && p.className, 'aria-hidden': true,
        },
          React.createElement('circle', { cx: 8, cy: 3, r: 1.5 }),
          React.createElement('circle', { cx: 4, cy: 12.5, r: 1.5 }),
          React.createElement('circle', { cx: 12, cy: 12.5, r: 1.5 }),
          React.createElement('path', { d: 'M8 4.5v2.2M8 6.7L4 11M8 6.7l4 4.3' }),
        )
        const toolboxGlyph = (p) => React.createElement('svg', {
          width: (p && p.size) || 16, height: (p && p.size) || 16, viewBox: '0 0 16 16', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
          className: p && p.className, 'aria-hidden': true,
        },
          React.createElement('rect', { x: 2, y: 5, width: 12, height: 8.5, rx: 1.5 }),
          React.createElement('path', { d: 'M5.5 5V3.8A1.3 1.3 0 0 1 6.8 2.5h2.4a1.3 1.3 0 0 1 1.3 1.3V5M2 8.2h12' }),
        )
        const nativeToolbox = OFFICIAL_TOOLBOX_ONLY
        const nativeId = nativeToolbox ? TOOLBOX_NATIVE_ID : FLOW_NATIVE_ID
        const nativeKind = nativeToolbox ? TOOLBOX_NATIVE_KIND : FLOW_NATIVE_KIND
        const nativeTitle = () => nativeToolbox
          ? FLOW_TEXT.toolboxTitle
          : FLOW_TEXT.toolTitle
        const nativeDescription = () => nativeToolbox
          ? FLOW_TEXT.toolboxDesc
          : FLOW_TEXT.toolDesc
        const definition = {
          id: nativeId,
          kind: nativeKind,
          title: nativeTitle,
          guide: [{
            order: 40,
            title: nativeTitle,
            description: nativeDescription,
            icon: nativeToolbox ? toolboxGlyph : flowGlyph,
          }],
        }
        let disposeType = null
        let disposeBody = null
        const nativeSlots = nativeCtx.get('slots')
        const retract = () => {
          if (disposeBody) { try { disposeBody() } catch (e) {} disposeBody = null }
          if (disposeType) { try { disposeType() } catch (e) {} disposeType = null }
          nativeOpenTab = null
          nativeFlowVisible = false
          nativeFlowReopenSession = ''
          integration.setNative(false)
        }
        const applyNative = () => {
          {
            if (!disposeType) {
              try { disposeType = tabs.register(definition) } catch (e) { retract(); return }
              disposeBody = nativeSlots && typeof nativeSlots.inject === 'function'
                ? nativeCtx.effect(() => nativeSlots.inject('sidebar.right.pane.tab', () => nativeSlots.register(
                  { name: 'sidebar.right.pane.tab', key: nativeId },
                  (tabProps) => React.createElement(nativeToolbox ? ToolboxNativeTabBody : FlowglassNativeTabBody, tabProps),
                )))
                : null
              nativeOpenTab = () => {
                if (controller && typeof controller.openTab === 'function') controller.openTab(nativeKind)
              }
              integration.setNative(true)
            }
          }
        }
        applyNative()
        const offMode = integration.subscribe(applyNative)
        nativeCtx.effect(() => () => {
          try { if (typeof offMode === 'function') offMode() } catch (e) {}
          retract()
        })
      })
    }

    if (RT.bundleId === 'flowglass-en' && typeof ctx.inject === 'function') {
      let bsService = null
      let bsDescriptor = null
      let bsDispose = null
      const syncBsRegistration = () => {
        if (!bsService || typeof bsService.registerTab !== 'function' || !bsDescriptor) return
        const want = !integration.native && integration.enabled !== false
        if (want && !bsDispose) {
          try {
            const d = bsService.registerTab(bsDescriptor)
            bsDispose = () => { try { d() } catch (e) {} }
          } catch (e) {
            bsDispose = null
            integration.sync(null)
            return
          }
        } else if (!want && bsDispose) {
          const d = bsDispose
          bsDispose = null
          try { d() } catch (e) {}
        }
      }
      ctx.inject(['betterSidebar'], (sidebarCtx) => {
        const service = sidebarCtx.get('betterSidebar')
        if (!service || typeof service.registerTab !== 'function') return
        const features = Array.isArray(service.features) ? service.features : []
        bsService = service
        bsDescriptor = {
          id: FLOW_TAB_ID,
          title: 'Flowglass',
          order: 35,
          single: true,
          description: 'View the current session, tool calls, and subagent execution flow',
          icon: (size) => React.createElement('svg', {
            width: size || 16, height: size || 16, viewBox: '0 0 16 16', fill: 'none',
            stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
          },
            React.createElement('circle', { cx: 8, cy: 3, r: 1.5 }),
            React.createElement('circle', { cx: 4, cy: 12.5, r: 1.5 }),
            React.createElement('circle', { cx: 12, cy: 12.5, r: 1.5 }),
            React.createElement('path', { d: 'M8 4.5v2.2M8 6.7L4 11M8 6.7l4 4.3' }),
          ),
          settings: features.indexOf('pluginSettings') < 0 ? undefined : {
            render: (sprops) => React.createElement(BetterSidebarFlowSettings, sprops),
          },
          component: (tabProps) => React.createElement(FlowglassSidebarView, tabProps),
        }
        const sync = () => { integration.sync(service); syncBsRegistration() }
        sync()
        const offState = features.indexOf('stateSubscription') >= 0 && typeof service.subscribeState === 'function'
          ? service.subscribeState(sync)
          : null
        const offIntegration = integration.subscribe(syncBsRegistration)
        sidebarCtx.effect(() => () => {
          try { if (typeof offState === 'function') offState() } catch (e) {}
          try { if (typeof offIntegration === 'function') offIntegration() } catch (e) {}
          if (bsDispose) { const d = bsDispose; bsDispose = null; try { d() } catch (e) {} }
          bsService = null
          bsDescriptor = null
          integration.sync(null)
        })
      })
    }
  },
}
