// ===== flow-tool.js:(Host-only, RPC )=====
//  session  → ("":,).
// ():
//   ·  session:  →  →  →  …(,)
//   · (subagent/workflow/ralph):git —— ├─ ,,╰─
//   · //MCP// : → ()
//   ·  Zoom(st.zoom):“”;( +  +  + ),
//     ; Harness .
// : data-autorefresh,(live ).
// :" →"( crumbs ,"← ").
// (DSH 0.1.5 , parseItems ):
//   · :Client  Session Controller (ctx.sessions.binding(sid).eventSource),
//      assistant/live-chunk  attempt  RPC (live );
//     settle-assistant ,Client  attempt  firstSeq  UI .
//   · //:Host sessionQuery(makeSessionLogReader ),
//     assistant/message  assistant/attempt  stream .
//   ·  assistant/chunk (0.1.2)——0.1.5 .
// :{ live, follow, limit, sid, home, expanded, crumbs, zoom, zoomScope, zoomRuns, zoomRunId }(, state)

return {
  name: 'flow-tool',
  inject: ['fs', 'sessionQuery', 'timer'],
  apply(ctx) {
    const sq = ctx.get('sessionQuery')
    const fs = ctx.get('fs')

    // ---- ( + ,)----
    const readers = {}
    const growth = {} // sid → : = ()
    const readLog = async (sid) => {
      if (!sq) return { events: [], count: 0 }
      if (!readers[sid]) readers[sid] = makeSessionLogReader(ctx, sq)
      try { return await readers[sid](sid) } catch (e) { return { events: [], count: 0 } }
    }

    // ---- ( trace :,)----
    let manifestTools = null
    const loadManifestTools = async () => {
      if (manifestTools) return
      manifestTools = []
      try {
        const found = await findManifest(ctx)
        const list = found && found.manifest && Array.isArray(found.manifest.plugins) ? found.manifest.plugins : []
        for (const e of list) {
          if (e && Array.isArray(e.modelTools)) {
            for (const n of e.modelTools) if (typeof n === 'string' && n) manifestTools.push(n)
          }
        }
      } catch (e) {}
    }
    const RE_SKILL = /^skill$/
    const RE_MCP = /mcp/i
    const RE_SUBAGENT = /^(subagent|subagent_fork|send_message|workflow|ralph)$/
    const RE_SHELL = /^(pwsh|bash|sh|terminal_(open|send|read|close|list|signal)|run_code)$/
    const RE_FILE = /^(read|write|edit|glob|grep|read_image)$/
    const kindOf = (name) => {
      if (/^cordis_/.test(name)) return 'cordis'
      if (/^ssh_/.test(name)) return 'cordis'
      if (manifestTools && manifestTools.indexOf(name) >= 0) return 'cordis'
      if (RE_SKILL.test(name)) return 'skill'
      if (RE_MCP.test(name)) return 'mcp'
      if (RE_SUBAGENT.test(name)) return 'subagent'
      if (RE_SHELL.test(name)) return 'shell'
      if (RE_FILE.test(name)) return 'file'
      return 'builtin'
    }
    const KIND_META = {
      skill: { label: 'Skill', color: '#7fa7f0', bg: 'rgba(91,141,239,.12)' },
      cordis: { label: 'Plugin', color: '#d4b95c', bg: 'rgba(212,167,44,.10)' },
      mcp: { label: 'MCP', color: '#81c784', bg: 'rgba(102,187,106,.10)' },
      shell: { label: 'Command', color: '#d4b95c', bg: 'rgba(212,167,44,.08)' },
      file: { label: 'File', color: '#7fa7f0', bg: 'rgba(91,141,239,.10)' },
      builtin: { label: 'Built-in', color: '#9a9ba6', bg: 'rgba(138,139,150,.10)' },
    }
    const getKindMeta = (cat) => KIND_META[cat] || KIND_META.builtin

    // ----  ----
    // /,,.Client  localStorage
    //  panel  JSON;Host ,.
    const MAX_PRESENTATION_RULES = 24
    const DEFAULT_PRESENTATION_RULES = [
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['git', 'git.exe'], displayName: 'Git', actions: [], badge: 'Git', color: '#f05032' },
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['gh', 'gh.exe', 'github', 'github.exe'], displayName: 'GitHub', actions: [], badge: 'GitHub', color: '#8b949e' },
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['pnpm', 'pnpm.cmd', 'pnpm.exe'], displayName: 'pnpm', actions: [], badge: 'pnpm', color: '#f69220' },
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['npm', 'npm.cmd', 'npm.exe'], displayName: 'npm', actions: [], badge: 'npm', color: '#cb3837' },
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['dsh', 'dsh.cmd', 'dsh.exe'], displayName: 'DSH', actions: [], badge: 'DSH', color: '#7fa7f0' },
      { enabled: true, tools: ['pwsh', 'bash', 'sh', 'run_code'], executables: ['python', 'python.exe', 'python3', 'python3.exe', 'py', 'py.exe'], displayName: 'Python', actions: [], badge: 'Python', color: '#3776ab' },
    ]
    const DEFAULT_FLOW_PREFERENCES = Object.freeze({
      keepOpenOnSessionSwitch: true,
      zoomEnabled: true,
      defaultBranchCount: 2,
      defaultZoomView: 'compact',
      refreshMs: 2000,
    })
    const normalizeFlowPreferences = (raw) => {
      let value = raw
      if (typeof value === 'string') {
        try { value = JSON.parse(value || '{}') } catch (e) { value = {} }
      }
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
    const flowPreferencesOf = (st) => st && st.__flowPreferences ? st.__flowPreferences : DEFAULT_FLOW_PREFERENCES
    const flowAutorefreshOf = (st) => {
      const ms = Number(flowPreferencesOf(st).refreshMs)
      return st.live && ms > 0 ? String(ms) : ''
    }
    const FLOW_HOST_TEXT = {
        noParams: '(No parameters)',
        callFail: '(Call failed)',
        emptyReturn: '(Empty output)',
        input: 'Input ',
        output: 'Output ',
        inProgress: 'In progress…',
        clickDetail: 'Click to view full input/output on the right',
        parallel: (n) => 'Parallel ×' + n,
        retryWait: (retry, max, remain) => '⟳ Awaiting retry ' + retry + max + (remain ? ' · ' + remain + 's' : ''),
        retryProgress: (retry, max) => '⟳ Retry ' + retry + max + ' · In progress',
        retryCancel: (retry, max) => '⟳ Retry ' + retry + max + ' canceled',
        retryFail: (retry, max) => '⟳ Retry ' + retry + max + ' · Failed',
        retryOk: (retry, max) => '⟳ Retry ' + retry + max + ' · Succeeded',
        maxTokens: '⤒ Max tokens reached',
        user: 'User',
        ai: 'Assistant',
        inject: 'System',
        userMsg: 'User Message',
        aiMsg: 'Assistant Message',
        injectMsg: 'System Message',
        detail: ' · Detail',
        branchHarness: 'Fork a new session from this assistant message in Harness',
        branchAria: 'Fork in new session',
        clickMsgDetail: 'Click to view full message',
        emptyMsg: '(Empty)',
        copyToClipboard: 'Copy content to clipboard',
        markdownPreview: 'Markdown Preview',
        skillDetailTitle: (name) => 'Skill · ' + name,
        closeDetail: 'Close detail',
        baseDir: 'Base directory',
        resourceNote: 'Resource instructions',
        usageInstructions: 'Instructions',
        rawReturn: 'Raw Return',
        fullXml: (truncated) => 'Full XML' + (truncated ? ' (Truncated)' : ''),
        fullInput: (truncated) => 'In · Full Input' + (truncated ? ' (Truncated)' : ''),
        fullOutput: (size) => 'Out · Full Output' + (size ? ' (' + size + ')' : ''),
        fullContent: (truncated) => 'Full Content' + (truncated ? ' (Truncated)' : ''),
        dragResize: 'Drag to resize (saved automatically)',
        inProgressNoReturn: '(In progress, no output yet)',
        timeLabel: (t) => 'Time ' + t,
        modelLabel: (m) => 'Model ' + m,
        tokLabel: (t) => 'Output +' + t + ' tok',
        finishKindLabel: (k) => 'Finish ' + k,
        errorLabel: (code, msg) => 'Error ' + code + (msg ? ': ' + msg : ''),
        retriesLabel: (count, path) => 'Retried ' + count + ' times (' + path + ')',
        subagentTag: 'Subagent',
        subagentTitleEnter: 'Enter live flow for this subagent',
        subagentTitleTask: 'Click to view full task input/output',
        running: 'Running',
        subagentFullFlow: 'Enter complete execution flow for this subagent (navigable back)',
        enterArrow: 'Enter →',
        subagentStarting: 'Subagent starting…',
        back: '← Back',
        subFlow: 'Subagent Flow',
        realtimeFlow: 'Live Flow',
        eventsAndNodes: (events, nodes, layer) => events + ' events · ' + nodes + ' nodes' + (layer ? ' · Layer ' + layer : ''),
        liveSyncing: '● Live syncing',
        paused: '⏸ Paused',
        subagentFollowOn: '● Subagent follow',
        subagentFollowOff: '○ Subagent follow',
        subagentFollowTip: 'When enabled, clicking a subagent switches the main Harness session',
        refresh: 'Refresh',
        flowZoomBtn: '⛶ Flow Zoom',
        flowZoomTip: 'Flow Zoom: Multi-session concurrent overview, compare execution branching, click cards to navigate to session',
        flowGuideAria: 'Flowglass instructions',
        flowNoEvents: 'No events in this session yet',
        flowOlderHint: (shown, older) => 'Showing latest ' + shown + ' nodes · Scroll up to load ' + older + ' earlier nodes',
        flowZoomTitle: 'Flow Zoom',
        zoomPanorama: 'Panorama',
        zoomNear: 'Inspect',
        zoomPanoramaTip: 'View all concurrent branches side by side',
        zoomNearTip: 'Inspect currently selected branch with full execution flow',
        zoomSessionsRunning: (total, running) => total + ' sessions · ' + running + ' running',
        sendMessage: ' Send',
        zoomGuideAria: 'Flow Zoom instructions',
        defaultFollowCurrent: 'Default (follow current)',
        thinkingFollowModel: 'Thinking: follow model',
        thinkingDefault: (d) => 'Thinking: ' + (d ? 'Default (' + d + ')' : 'Default'),
        reuseCurrentSession: 'Reuse current session',
        targetBranchCount: 'Target branches',
        compactView: 'Compact',
        detailView: 'Detail',
        mapView: 'Mind Map',
        flowZoomHistory: (n) => 'Flow Zoom History · ' + n,
        flowZoomHistoryDrawerTitle: 'Flow Zoom History',
        noConcurrentRecords: 'No concurrent records yet — enter a task and click ⚡ Start Concurrently',
        noDisplayableSessions: 'No displayable sessions',
        noBranchSessions: 'No branch sessions yet — click ⚡ Start Concurrently or delegate to subagents',
        sessionNotFound: 'Current session not found',
    }
    const tHost = (st, key, ...args) => {
      const val = FLOW_HOST_TEXT[key]
      if (typeof val === 'function') return val(...args)
      return val != null ? val : key
    }
    const textField = (value, name, max) => {
      if (typeof value !== 'string' || !value.trim()) throw new Error('Presentation rule is missing ' + name)
      const out = value.trim()
      if (out.length > max) throw new Error('Presentation rule ' + name + ' must be at most ' + max + ' characters')
      return out
    }
    const optionalTextField = (value, name, max) => {
      if (value == null || value === '') return ''
      return textField(value, name, max)
    }
    const stringList = (value, name, maxItems, maxLength, required) => {
      if (value == null && !required) return []
      if (!Array.isArray(value) || (required && value.length === 0) || value.length > maxItems) {
        throw new Error('Presentation rule ' + name + ' must be an array of 1–' + maxItems + ' strings')
      }
      const out = []
      for (const item of value) {
        const s = textField(item, name, maxLength)
        if (!out.includes(s)) out.push(s)
      }
      return out
    }
    const normalizePresentationRules = (raw) => {
      let value = raw
      if (typeof value === 'string') {
        if (value.length > 16000) throw new Error('Presentation rules JSON must not exceed 16000 characters')
        try { value = JSON.parse(value || '[]') } catch (e) { throw new Error('Presentation rules must be valid JSON') }
      }
      if (!Array.isArray(value) || value.length > MAX_PRESENTATION_RULES) {
        throw new Error('Presentation rules must be an array with at most ' + MAX_PRESENTATION_RULES + ' entries')
      }
      return value.map((rule, index) => {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('Presentation rule ' + (index + 1) + ' must be an object')
        const color = rule.color == null || rule.color === '' ? '#81c784' : textField(rule.color, 'color', 7)
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Presentation rule ' + (index + 1) + ' color must be #RRGGBB')
        return {
          enabled: rule.enabled !== false,
          tools: stringList(rule.tools, 'tools', 8, 64, true),
          executables: stringList(rule.executables, 'executables', 12, 128, true),
          displayName: optionalTextField(rule.displayName, 'displayName', 80),
          actions: stringList(rule.actions, 'actions', 32, 64, false),
          badge: optionalTextField(rule.badge, 'badge', 12),
          color: color.toLowerCase(),
        }
      })
    }
    const commaList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
    const ruleFromFields = (fields, prefix) => ({
      enabled: fields[prefix + '.enabled'] !== '0',
      tools: commaList(fields[prefix + '.tools']),
      executables: commaList(fields[prefix + '.executables']),
      displayName: String(fields[prefix + '.displayName'] || ''),
      actions: commaList(fields[prefix + '.actions']),
      badge: String(fields[prefix + '.badge'] || ''),
      color: String(fields[prefix + '.color'] || ''),
    })
    const commandTokens = (command) => String(command || '').match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g) || []
    const cleanToken = (token) => String(token || '').replace(/^[&'"(]+|['"),;]+$/g, '')
    const tokenBasename = (token) => {
      const clean = cleanToken(token).replace(/[\\/]+$/, '')
      const parts = clean.split(/[\\/]/)
      return (parts[parts.length - 1] || '').toLowerCase()
    }
    const commandOf = (call) => {
      try {
        const args = JSON.parse(call.argsRaw || '{}')
        return typeof args.command === 'string' ? args.command : ''
      } catch (e) { return '' }
    }
    const displayIdentity = (call, rules, st) => {
      const kindMeta = getKindMeta(call.cat)
      const fallback = { name: call.name, meta: kindMeta }
      if (call.name === 'skill') {
        try {
          const args = JSON.parse(call.argsRaw || '{}')
          if (typeof args.name === 'string' && args.name.trim()) return { name: args.name.trim(), meta: getKindMeta('skill') }
        } catch (e) {}
        return fallback
      }
      if (!Array.isArray(rules) || !rules.length) return fallback
      const command = commandOf(call)
      if (!command) return fallback
      const tokens = commandTokens(command)
      for (const rule of rules) {
        if (!rule.enabled || !rule.tools.includes(call.name)) continue
        const wanted = rule.executables.map((value) => tokenBasename(value))
        const at = tokens.findIndex((token) => wanted.includes(tokenBasename(token)))
        if (at < 0) continue
        const action = cleanToken(tokens[at + 1] || '')
        if (rule.actions.length && !rule.actions.includes(action)) continue
        return {
          name: [rule.displayName, action].filter(Boolean).join(' '),
          meta: { label: rule.badge, color: rule.color, bg: rule.color + '1f' },
        }
      }
      return fallback
    }

    const pad2 = (n) => (n < 10 ? '0' : '') + n
    const fmtTime = (t) => {
      const d = new Date(t)
      if (isNaN(d.getTime())) return '' //  time , NaN:NaN:NaN
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    }
    const fmtDur = (ms) => ms == null ? '' : (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's')
    const oneLine = (s, max) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }
    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
    }

    // ---- 0.1.5 ()----
    // AssistantStreamRecord[](assistant/message / assistant/attempt )
    // → [{ time, chunk }] ;text-chunks/reasoning-chunks/tool-call-chunks
    // time0+dt[]  delta ,'chunk' .
    const expandStreamRecords = (stream) => {
      const out = []
      if (!Array.isArray(stream)) return out
      for (const rec of stream) {
        if (!rec || typeof rec !== 'object') continue
        if (rec.type === 'chunk') {
          if (rec.chunk && typeof rec.chunk === 'object') out.push({ time: rec.time, chunk: rec.chunk })
        } else if (rec.type === 'text-chunks' || rec.type === 'reasoning-chunks') {
          const texts = Array.isArray(rec.texts) ? rec.texts : []
          let t = typeof rec.time0 === 'number' ? rec.time0 : 0
          for (let i = 0; i < texts.length; i++) {
            if (i > 0 && Array.isArray(rec.dt)) t += typeof rec.dt[i - 1] === 'number' ? rec.dt[i - 1] : 0
            out.push({ time: t, chunk: { type: rec.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta', index: rec.index, text: String(texts[i]) } })
          }
        } else if (rec.type === 'tool-call-chunks') {
          const args = Array.isArray(rec.args) ? rec.args : []
          let t = typeof rec.time0 === 'number' ? rec.time0 : 0
          for (let i = 0; i < args.length; i++) {
            if (i > 0 && Array.isArray(rec.dt)) t += typeof rec.dt[i - 1] === 'number' ? rec.dt[i - 1] : 0
            out.push({ time: t, chunk: { type: 'tool-call-delta', index: rec.index, id: rec.id, name: rec.name, argumentsDelta: String(args[i]) } })
          }
        }
      }
      return out
    }

    //  attempt :assistant/live-chunk  stream .
    // attemptId (assistant-attempt:<id>);seq() UI .
    const makeAttemptState = (attemptId, turn, step) => ({
      attemptId: String(attemptId || ''), turn, step,
      firstSeq: null, firstAt: null, lastAt: null,
      text: '', reasoning: '', toolCall: false,
      finishKind: '', failCode: '', failMsg: '', usage: null,
    })
    const applyChunkToAttempt = (a, time, chunk) => {
      if (a.firstAt == null) a.firstAt = time
      a.lastAt = time
      if (!chunk || typeof chunk !== 'object') return
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') a.text += chunk.text
      else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') a.reasoning += chunk.text
      else if (chunk.type === 'tool-call-delta') a.toolCall = true
      else if (chunk.type === 'usage' && chunk.usage) a.usage = chunk.usage
      else if (chunk.type === 'finish' && chunk.reason) {
        a.finishKind = String(chunk.reason.kind || '')
        const f = chunk.reason.failure
        if (f && typeof f === 'object') {
          a.failCode = typeof f.code === 'string' ? f.code : ''
          a.failMsg = typeof f.message === 'string' ? f.message : ''
        }
      }
    }
    // Client  attempt (eventSource  Client )→  attempt
    const attemptFromSnapshot = (snap) => {
      const a = makeAttemptState(
        snap && snap.attemptId,
        snap && typeof snap.turn === 'number' ? snap.turn : null,
        snap && typeof snap.step === 'number' ? snap.step : null,
      )
      if (!snap) return a
      a.firstSeq = typeof snap.firstSeq === 'number' ? snap.firstSeq : null
      a.firstAt = typeof snap.firstAt === 'number' ? snap.firstAt : null
      a.lastAt = typeof snap.lastAt === 'number' ? snap.lastAt : a.firstAt
      // Remote JSON is a trust boundary. The Client normally applies the same
      // cap, but a stale or modified caller must not make the Host render an
      // unbounded live overlay.
      a.text = String(snap.text || '').slice(0, 8000)
      a.reasoning = String(snap.reasoning || '').slice(0, 8000)
      a.toolCall = Boolean(snap.toolCall)
      if (snap.finish && typeof snap.finish === 'object') {
        a.finishKind = String(snap.finish.kind || '')
        a.failCode = typeof snap.finish.code === 'string' ? snap.finish.code : ''
        a.failMsg = typeof snap.finish.message === 'string' ? snap.finish.message : ''
      }
      return a
    }

    // ----  → (:live  + )----
    // live = { sessionId, revision, attempts: [...], settled: [...] }:
    //   attempts ——  attempt ();
    //   settled  ——  attempt  { turn, step, firstSeq }( firstSeq,
    //                // UI  settle ).
    const parseItems = (events, live) => {
      const items = []
      const byCallId = {}
      const stepStarts = {} // turn:step → step/start ;, token
      const stepEnds = {} // turn:step → step/end ; message (/)
      const turnEnds = {} // turn → turn/end ;step/end
      const retriesByStep = {} // turn:step → dsh-llm-retry (llm/retry ,)
      const retryById = {} // retryId → ;llm/retry-started  id
      let route = '' //  request/header  provider/model,
      let curTurn = null //  turn/start :user/message  turn,
      // turn:step → (durable message / durable attempts /  live attempt )
      const stepCards = new Map()

      const stepKey = (turn, step) => String(turn) + ':' + step
      const cardOf = (turn, step) => {
        const k = stepKey(turn, step)
        let c = stepCards.get(k)
        if (!c) {
          c = { key: k, turn, step, uiSeq: null, attempts: [], message: null, live: null }
          stepCards.set(k, c)
        }
        return c
      }

      //  Client  attempt ( attempt, attempt )
      if (live && Array.isArray(live.attempts)) {
        for (const snap of live.attempts) {
          if (!snap || snap.attemptId == null) continue
          const a = attemptFromSnapshot(snap)
          if (a.turn == null || a.step == null) continue
          cardOf(a.turn, a.step).live = a
        }
      }

      for (const ev of events) {
        if (!ev || typeof ev.seq !== 'number') continue
        const d = ev.data || {}
        if (ev.type === 'turn/start') { if (typeof d.turn === 'number') curTurn = d.turn; continue }
        if (ev.type === 'step/start') {
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          stepStarts[stepKey(turn, step)] = ev.time
          cardOf(turn, step)
          continue
        }
        if (ev.type === 'step/end') {
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          stepEnds[stepKey(turn, step)] = ev.time
          continue
        }
        if (ev.type === 'turn/end') {
          if (typeof d.turn === 'number') turnEnds[d.turn] = ev.time
          continue
        }
        // dsh-llm-retry :(),.
        //  step —— turn:step →→,.
        if (ev.type === 'llm/retry') {
          const key = String(d.turn) + ':' + d.step
          const f = d.failure || {}
          const entry = { retry: d.retry, maxRetries: d.maxRetries, delayMs: d.delayMs, code: typeof f.code === 'string' ? f.code : '', message: typeof f.message === 'string' ? f.message : '', time: ev.time, startedAt: 0 }
          ;(retriesByStep[key] || (retriesByStep[key] = [])).push(entry)
          if (typeof d.retryId === 'string' && d.retryId) retryById[d.retryId] = entry
          continue
        }
        if (ev.type === 'llm/retry-started') {
          const r = typeof d.retryId === 'string' ? retryById[d.retryId] : null
          if (r) r.startedAt = ev.time
          continue
        }
        if (ev.type === 'request/header') {
          const cfg = d.header && d.header.config
          if (cfg && cfg.model) route = (cfg.provider ? cfg.provider + '/' : '') + cfg.model
          continue
        }
        if (ev.type === 'tool/call') {
          const it = {
            kind: 'call', seq: ev.seq, time: ev.time, turn: d.turn, step: d.step,
            name: String(d.name || '?'), cat: kindOf(String(d.name || '')),
            argsRaw: typeof d.arguments === 'string' ? d.arguments : '',
            status: 'pending', dur: null, resultText: '', outLen: 0,
          }
          items.push(it)
          if (d.callId != null) byCallId[String(d.callId)] = it
        } else if (ev.type === 'tool/result') {
          const m = d.message || {}
          //  content  toolCallId ( tool-result )
          let callId = null
          let text = ''
          if (Array.isArray(m.content)) {
            for (const block of m.content) {
              if (callId == null && block && block.toolCallId != null) callId = String(block.toolCallId)
              if (!text && block) { const t = textOf(block.content); if (t) text = t }
            }
          }
          const failed = !!(d.error || (Array.isArray(m.content) && m.content[0] && m.content[0].isError))
          const it = callId ? byCallId[callId] : null
          if (it) {
            it.status = failed ? 'error' : 'ok'
            it.dur = ev.time - it.time
            it.resultText = text
            it.outLen = text.length
            it.resSeq = ev.seq // :""
          }
        } else if (ev.type === 'user/message') {
          const src = d.source && d.source.kind ? String(d.source.kind) : 'user'
          const preview = oneLine(textOf(d.content), 110)
          // (subagent-settled ),
          if (src !== 'user' && !preview) continue
          items.push({ kind: 'msg', role: src === 'user' ? 'user' : 'inject', seq: ev.seq, time: ev.time, turn: curTurn, preview, full: textOf(d.content) })
        } else if (ev.type === 'assistant/live-chunk') {
          // (/; live.attempts ).
          //  attemptId ; attemptId ().
          if (d.attemptId == null) continue
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          const card = cardOf(turn, step)
          let a = card.live && card.live.attemptId === String(d.attemptId) ? card.live : null
          if (!a) {
            a = makeAttemptState(d.attemptId, turn, step)
            card.live = a
          }
          if (a.firstSeq == null) a.firstSeq = ev.seq
          applyChunkToAttempt(a, ev.time, d.chunk)
        } else if (ev.type === 'assistant/message' || ev.type === 'assistant/attempt') {
          // : stream;message ,attempt /.
          const turn = typeof d.turn === 'number' ? d.turn : curTurn
          const step = typeof d.step === 'number' ? d.step : 0
          const card = cardOf(turn, step)
          const a = makeAttemptState(null, turn, step)
          for (const { time, chunk } of expandStreamRecords(d.stream)) applyChunkToAttempt(a, time, chunk)
          if (ev.type === 'assistant/message') {
            card.message = { ev, data: d, stream: a, route }
          } else {
            card.attempts.push({ ev, stream: a })
          }
        }
      }

      // ---- :turn:step → ( → , UI )----
      for (const card of stepCards.values()) {
        const k = card.key
        // UI :/ attempt  firstSeq  seq
        let uiSeq = null
        if (card.live) uiSeq = card.live.firstSeq
        if (uiSeq == null && live && Array.isArray(live.settled)) {
          const hit = live.settled.find((s) => s && s.turn === card.turn && s.step === card.step && typeof s.firstSeq === 'number')
          if (hit) uiSeq = hit.firstSeq
        }
        let it
        if (card.message) {
          // ():durable message
          const { ev, data, stream, route: msgRoute } = card.message
          const m = data.message || {}
          const u = data.usage || stream.usage || null
          const finalText = textOf(m.content)
          it = {
            kind: 'msg', role: 'ai', seq: uiSeq != null ? uiSeq : ev.seq, time: ev.time, turn: card.turn, step: card.step,
            attemptId: card.live ? card.live.attemptId : '',
            akey: card.live ? 'assistant-attempt:' + card.live.attemptId : 'assistant-event:' + ev.seq,
            finalSeq: ev.seq, runStart: stepStarts[k] != null ? stepStarts[k] : (stream.firstAt != null ? stream.firstAt : ev.time),
            runDur: Math.max(0, ev.time - (stepStarts[k] != null ? stepStarts[k] : (stream.firstAt != null ? stream.firstAt : ev.time))),
            preview: oneLine(finalText, 110) || (stream.toolCall ? '(tool call)' : (stream.reasoning ? oneLine(stream.reasoning, 110) : '(empty response)')),
            full: finalText || stream.text || stream.reasoning,
            tok: u ? (u.outputTokens || 0) : null, route: msgRoute || route,
            streaming: false, settled: true,
            interrupted: data.interrupted === true,
            finishKind: stream.finishKind || (data.interrupted === true ? 'interrupted' : ''),
            failCode: '', failMsg: '',
          }
        } else if (card.attempts.length && !card.live) {
          // //: attempt, message →
          const last = card.attempts[card.attempts.length - 1]
          const s = last.stream
          const failed = s.finishKind === 'error' || s.finishKind === 'aborted' || Boolean(s.failCode)
          const uiSeqFinal = uiSeq != null ? uiSeq : last.ev.seq
          const runFrom = stepStarts[k] != null ? stepStarts[k] : (s.firstAt != null ? s.firstAt : last.ev.time)
          const runTo = s.lastAt != null ? s.lastAt : last.ev.time
          it = {
            kind: 'msg', role: 'ai', seq: uiSeqFinal, time: last.ev.time, turn: card.turn, step: card.step,
            attemptId: '', akey: 'assistant-event:' + last.ev.seq, finalSeq: last.ev.seq,
            runStart: runFrom, runDur: Math.max(0, runTo - runFrom),
            preview: (s.text || s.reasoning ? oneLine(s.text || s.reasoning, 100) + ' ' : '') + (s.finishKind === 'aborted' ? '(aborted)' : '(failed)'),
            full: s.text || s.reasoning,
            tok: null, route, streaming: false, settled: true,
            interrupted: false, failed: s.finishKind === 'error' || Boolean(s.failCode),
            abandoned: s.finishKind === 'aborted',
            finishKind: s.finishKind, failCode: s.failCode || '', failMsg: s.failMsg || '',
          }
          if (!failed && !s.failCode && s.finishKind !== 'aborted') it.preview = oneLine(s.text || s.reasoning, 110) || '(empty response)'
          // ( step/end, live) → :
          // ( live attempt )
          const rsEarly = retriesByStep[k]
          const stepOpen = stepEnds[k] == null && (card.turn == null || turnEnds[card.turn] == null)
          const pendRetry = rsEarly && rsEarly.length && !rsEarly[rsEarly.length - 1].startedAt
          if (rsEarly && rsEarly.length) it.retries = rsEarly
          if (stepOpen) {
            it.interrupted = !pendRetry //  → ()
            it.awaitingRetry = Boolean(pendRetry)
          } else {
            it.interrupted = true
          }
          items.push(it)
          continue
        } else {
          // ( attempt): durable message/attempt
          const a = card.live
          if (!a) continue
          it = {
            kind: 'msg', role: 'ai', seq: a.firstSeq != null ? a.firstSeq : (a.firstAt != null ? a.firstAt : Date.now()),
            time: a.firstAt, turn: card.turn, step: card.step,
            attemptId: a.attemptId, akey: 'assistant-attempt:' + a.attemptId, finalSeq: null,
            runStart: stepStarts[k] != null ? stepStarts[k] : (a.firstAt != null ? a.firstAt : Date.now()),
            preview: '', full: a.text || a.reasoning,
            tok: null, route, streaming: true, settled: false,
            finishKind: a.finishKind, failCode: a.failCode || '', failMsg: a.failMsg || '',
          }
          const endedAt = stepEnds[k] != null ? stepEnds[k]
            : (card.turn != null && turnEnds[card.turn] != null ? turnEnds[card.turn] : null)
          if (endedAt != null && !a.text && !a.reasoning && !a.toolCall && a.finishKind === '') {
            // ( baseline )→
            continue
          }
          if (endedAt != null || a.finishKind === 'error' || a.finishKind === 'aborted') {
            // /() durable  → //:
            // (),
            it.streaming = false
            it.interrupted = true
            it.failed = a.finishKind === 'error' || Boolean(a.failCode)
            it.abandoned = a.finishKind === 'aborted'
            it.settled = a.finishKind !== ''
            const endRef = endedAt != null ? endedAt : (a.lastAt != null ? a.lastAt : it.runStart)
            it.runDur = Math.max(0, endRef - it.runStart)
            it.preview = (it.full ? oneLine(it.full, 100) + ' ' : '') + (it.abandoned ? '(aborted)' : '(failed)')
          } else {
            it.preview = oneLine(it.full, 110) || (a.toolCall ? '…' : (a.reasoning ? '…' : '…'))
          }
        }
        // ()
        const rs = retriesByStep[k]
        if (rs && rs.length) it.retries = rs
        items.push(it)
      }
      //  seq :live  seq
      const order = items.map((it, i) => [it.seq, i, it])
      order.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]))
      return order.map((e) => e[2])
    }

    // ----  → :;; ----
    const buildNodes = (items) => {
      const nodes = []
      for (const it of items) {
        if (it.kind === 'msg') { nodes.push({ t: 'msg', it }); continue }
        if (it.cat === 'subagent') {
          const last = nodes[nodes.length - 1]
          //  step :,
          //  N  N ,.
          if (last && last.t === 'subs' && last.turn === it.turn && last.step === it.step) last.calls.push(it)
          else nodes.push({ t: 'subs', turn: it.turn, step: it.step, calls: [it] })
          continue
        }
        const last = nodes[nodes.length - 1]
        if (last && last.t === 'par' && last.turn === it.turn && last.step === it.step) last.calls.push(it)
        else nodes.push({ t: 'par', turn: it.turn, step: it.step, calls: [it] })
      }
      return nodes
    }

    // ----  →  id( / alpha.4 send_message)----
    const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i
    const childIdOf = (call) => {
      const m = /(?:subagent|agent)\s+([0-9a-f]{8}-[0-9a-f-]{27,})/i.exec(call.resultText || '')
      if (m) return m[1]
      if (call && call.name === 'send_message') {
        try {
          const args = JSON.parse(call.argsRaw || '{}')
          const id = args && typeof args.agent_id === 'string' ? args.agent_id.trim() : ''
          if (SESSION_ID_RE.test(id)) return id
        } catch (e) {}
      }
      return null
    }
    // :(;/)
    const childRows = async (childId, cap) => {
      const r = await readLog(childId)
      if (!r.events || !r.events.length) return { rows: [], live: false, total: 0 }
      const items = parseItems(r.events)
      const rows = []
      for (const it of items) {
        if (it.kind === 'msg') {
          if (it.role === 'ai') rows.push({ txt: it.preview, cls: 'ai' })
        } else {
          const km = KIND_META[it.cat] || KIND_META.builtin
          rows.push({ txt: it.name + ' ' + oneLine(it.argsRaw, 40), cls: '', pill: km.label, status: it.status, dur: it.dur })
        }
      }
      let live = false
      try {
        const agentsSvc = ctx.get('agents')
        if (agentsSvc) {
          const agent = agentsSvc.get(childId)
          live = !!(agent && agent.status === 'running')
        } else {
          //  harness/ agents , session .
          const sessionsSvc = ctx.get('sessions')
          live = !!(sessionsSvc && sessionsSvc.get(childId))
        }
      } catch (e) {}
      return { rows: rows.slice(-cap), live, total: rows.length }
    }

    // ----  ----
    const statusGlyph = (s, dur) => {
      if (s === 'ok') return '<span class="fl-status" style="color:var(--tb-done-text,#81c784)">✓ ' + fmtDur(dur) + '</span>'
      if (s === 'error') return '<span class="fl-status" style="color:var(--tb-danger-text,#f28b82)">✗ ' + fmtDur(dur) + '</span>'
      return '<span class="fl-spin"></span>'
    }

    // :/(—— skill ,skill )
    // : arguments JSON (command/file_path/pattern/prompt…), JSON
    const ARG_KEYS = ['command', 'file_path', 'path', 'pattern', 'query', 'q', 'description', 'prompt', 'text', 'content', 'url', 'name', 'key', 'expression', 'expr', 'code', 'script', 'tool', 'method', 'message', 'input', 'old_string', 'new_string']
    const inSummary = (c, st) => {
      try {
        const a = JSON.parse(c.argsRaw || '{}')
        for (const k of ARG_KEYS) {
          if (typeof a[k] === 'string' && a[k].trim()) return k + ': ' + oneLine(a[k], 72)
          if (typeof a[k] === 'number' || typeof a[k] === 'boolean') return k + ': ' + a[k]
        }
        const ks = Object.keys(a)
        if (ks.length) return ks[0] + ': ' + oneLine(String(a[ks[0]]), 72)
        return tHost(st, 'noParams')
      } catch (e) { return oneLine(c.argsRaw, 72) || tHost(st, 'noParams') }
    }
    // : +  +
    const outSummary = (c, st) => {
      if (c.status === 'pending') return null
      if (c.status === 'error') {
        const t = (c.resultText || '').trim()
        return { text: t ? oneLine(t, 72) : tHost(st, 'callFail'), err: true }
      }
      const lines = String(c.resultText || '').split('\n').map((s) => s.trim()).filter(Boolean)
      const first = lines[0] || ''
      return { text: (first ? oneLine(first, 72) : tHost(st, 'emptyReturn')) + (c.outLen > 72 ? ' · ' + fmtSize(c.outLen) : ''), err: false }
    }
    // (·:,,——
    // = +  + ▶ ;=◀ +  +  ;,,);
    // ();/()
    const renderCallWire = (c, expandedSeq, presentationRules, st) => {
      const identity = displayIdentity(c, presentationRules, st)
      const km = identity.meta
      const isExp = expandedSeq === c.seq
      const pending = c.status === 'pending'
      const o = outSummary(c, st)
      const inLabel = tHost(st, 'input')
      const outLabel = tHost(st, 'output')
      return '<div class="fl-wp" data-flow-card="' + c.seq + '" data-flow-status="' + c.status + '">' +
          '<div class="fl-wl"><span class="fl-wl-txt">' + inLabel + esc(inSummary(c, st)) + '</span>' +
            '<span class="fl-wl-row"><span class="fl-wl-line"></span><span class="fl-wl-arr">▶</span></span></div>' +
          (pending
            ? '<div class="fl-wl fl-wl-b fl-wl-wait"><span class="fl-wl-txt">' + outLabel + tHost(st, 'inProgress') + '</span>' +
              '<span class="fl-wl-row"><span class="fl-wl-arr">◀</span><span class="fl-wl-line"></span></span></div>'
            : '<div class="fl-wl fl-wl-b' + (o && o.err ? ' fl-wl-err' : '') + '"><span class="fl-wl-txt">' + outLabel + esc(o ? o.text : '') + '</span>' +
              '<span class="fl-wl-row"><span class="fl-wl-arr">◀</span><span class="fl-wl-line"></span></span></div>') +
        '</div>' +
        '<div class="fl-callside">' +
          '<div class="fl-iocard' + (pending ? ' fl-live' : '') + (isExp ? ' fl-on' : '') + (o && o.err ? ' fl-err' : '') + '" data-action="fdetail" data-seq="' + c.seq + '" data-flow-select-seq="' + c.seq + '" title="' + tHost(st, 'clickDetail') + '">' +
            '<div class="fl-iohead">' + (km.label ? '<span class="fl-tag" style="color:' + km.color + ';background:' + km.bg + '">' + esc(km.label) + '</span>' : '') +
            '<span class="fl-name">' + esc(identity.name) + '</span>' +
            (pending ? '<span class="fl-spin"></span><span class="fl-time" data-flow-timer="' + c.time + '" data-flow-timer-prefix="⏱ ">⏱ 0ms</span>' : statusGlyph(c.status, c.dur)) + '</div>' +
          '</div>' +
        '</div>'
    }

    // (>1) + " ×N";
    const grpSide = (node, units, st) => {
      const n = node.calls.length
      if (n < 2) return '<div class="fl-lane-side">' + units + '</div>'
      return '<div class="fl-lane-side fl-grp"><span class="fl-grp-tag">' + tHost(st, 'parallel', n) + '</span>' + units + '</div>'
    }

    // :(▼  ::before ,▼ )+  +
    // —— ,▼ " → "();()
    const connMain = (content, withConn) =>
      (withConn ? '<div class="fl-conn"><span class="fl-arrow">▼</span></div>' : '') +
      content +
      (withConn ? '<span class="fl-conn-gap"></span>' : '')

    // (,):—— ▼ ()
    const renderPar = (node, expandedSeq, presentationRules, st) => {
      const units = node.calls.map((c) => renderCallWire(c, expandedSeq, presentationRules, st)).join('')
      return '<div class="fl-lane"><div></div>' +
        '<div class="fl-lane-main"><span class="fl-lane-line"></span></div>' +
        grpSide(node, units, st) +
      '</div>'
    }

    // /(llm/retry  + ):( 2s );
    // /; =
    const retryBadgeHtml = (it, st) => {
      let out = ''
      const rs = it.retries
      if (rs && rs.length) {
        const last = rs[rs.length - 1]
        const max = typeof last.maxRetries === 'number' ? '/' + last.maxRetries : ''
        const tip = esc((last.code || '') + (last.message ? ':' + last.message : ''))
        if ((it.streaming || it.awaitingRetry) && !last.startedAt) {
          const remain = Math.max(0, Math.ceil((last.time + (last.delayMs || 0) - Date.now()) / 1000))
          out += '<span class="fl-retry fl-retry-wait" title="' + tip + '">' + tHost(st, 'retryWait', last.retry, max, remain) + '</span>'
        } else if (it.streaming) {
          out += '<span class="fl-retry fl-retry-wait" title="' + tip + '">' + tHost(st, 'retryProgress', last.retry, max) + '</span>'
        } else if (!last.startedAt) {
          out += '<span class="fl-retry fl-retry-cancel" title="Retry cancelled">' + tHost(st, 'retryCancel', last.retry, max) + '</span>'
        } else if (it.interrupted) {
          out += '<span class="fl-retry fl-retry-fail" title="' + tip + '">' + tHost(st, 'retryFail', last.retry, max) + '</span>'
        } else {
          out += '<span class="fl-retry fl-retry-ok" title="' + tip + '">' + tHost(st, 'retryOk', last.retry, max) + '</span>'
        }
      }
      if (it.interrupted && it.failCode) {
        out += '<span class="fl-retry fl-retry-fail" title="' + esc(it.failMsg || '') + '">✗ ' + esc(it.failCode) + '</span>'
      }
      if (it.finishKind === 'max-tokens') {
        out += '<span class="fl-retry fl-retry-cancel" title=" max-tokens ">' + tHost(st, 'maxTokens') + '</span>'
      }
      return out
    }

    const msgCardInner = (it, expandedSeq, live, st) => {
      const isUser = it.role === 'user'
      const isAi = it.role === 'ai'
      const aiRunning = isAi && it.streaming
      const color = isUser ? 'var(--tb-done-text,#81c784)' : isAi ? 'var(--tb-active-text,#7fa7f0)' : 'var(--tb-text-3,#777884)'
      const label = isUser ? tHost(st, 'user') : isAi ? tHost(st, 'ai') : tHost(st, 'inject')
      // (fl-node), + /tag ,
      // //();live= →
      // data-flow-state (streaming/settled/failed/abandoned);data-flow-attempt  attempt
      const branchSeq = it.finalSeq != null ? it.finalSeq : it.seq
      const flowState = it.streaming ? 'streaming' : (it.abandoned ? 'abandoned' : (it.failed || (it.interrupted && it.failCode) ? 'failed' : 'settled'))
      const branch = isAi && !it.streaming
        ? '<button type="button" class="fl-branch-btn" data-flow-branch data-seq="' + branchSeq + '" title="' + tHost(st, 'branchHarness') + '" aria-label="' + tHost(st, 'branchAria') + '">' +
          '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3v5a3 3 0 0 0 3 3h4"/><path d="M8 5l3-3 3 3"/><path d="M11 2v4"/><path d="M9 9l2 2-2 2"/></svg></button>'
        : ''
      return '<div class="fl-node' + (expandedSeq === it.seq ? ' fl-on' : '') + (live ? ' fl-live' : '') + '" style="border-left-color:' + color + '" data-flow-main-card="' + it.seq + '" data-flow-role="' + it.role + '" data-flow-state="' + flowState + '"' + (isAi && it.attemptId ? ' data-flow-attempt="' + esc(it.attemptId) + '"' : '') + ' data-flow-select-seq="' + it.seq + '" data-action="fdetail" data-seq="' + it.seq + '" title="' + tHost(st, 'clickMsgDetail') + '">' +
        '<div class="fl-node-head"><span class="fl-glyph" style="color:' + color + '">' + (isUser ? '▲' : isAi ? '◆' : '■') + '</span><span class="fl-tag" style="color:' + color + '">' + label + '</span>' +
        (isAi && it.route ? '<span class="fl-model">' + esc(it.route) + '</span>' : '') +
        (fmtTime(it.time) ? '<span class="fl-time">' + fmtTime(it.time) + '</span>' : '') +
        (aiRunning && it.runStart ? '<span class="fl-time" data-flow-timer="' + it.runStart + '" data-flow-timer-prefix="⏱ ">⏱ 0ms</span>' : (isAi && it.runDur != null ? '<span class="fl-time">⏱ ' + fmtDur(it.runDur) + '</span>' : '')) +
        (it.tok ? '<span class="fl-time">+' + it.tok + ' tok</span>' : '') + (isAi ? retryBadgeHtml(it, st) : '') + branch + '</div>' +
        '<div class="fl-preview"' + (it.interrupted ? ' style="color:var(--tb-danger-text,#f28b82)"' : '') + '>' + esc(it.preview || tHost(st, 'emptyMsg')) + '</div>' +
      '</div>'
    }

    const renderMsg = (it, expandedSeq, withConn, live, st) => '<div class="fl-lane"><div></div><div class="fl-lane-main">' + connMain(msgCardInner(it, expandedSeq, live, st), withConn) + '</div><div></div></div>'

    const copyButtonHtml = (st) => '<button type="button" class="fl-copy-btn" data-flow-copy="1" title="' + tHost(st, 'copyToClipboard') + '" aria-label="' + tHost(st, 'copyToClipboard') + '">' +
      '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11H2.5A1.5 1.5 0 0 1 1 9.5v-7A1.5 1.5 0 0 1 2.5 1h7A1.5 1.5 0 0 1 11 2.5V3"/></svg></button>'
    const markdownPreviewButtonHtml = (seq, st) => '<button type="button" class="fl-md-preview-btn" data-flow-markdown-preview="1" data-flow-markdown-key="' + seq + '" title="' + tHost(st, 'markdownPreview') + '" aria-label="' + tHost(st, 'markdownPreview') + '" aria-pressed="false">' +
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.8"/></svg></button>'

    const skillDetailOf = (c) => {
      if (c.name !== 'skill' || c.status !== 'ok') return null
      let requestedName = ''
      try {
        const args = JSON.parse(c.argsRaw || '{}')
        if (typeof args.name === 'string') requestedName = args.name.trim()
      } catch (e) {}
      const raw = String(c.resultText || '')
      const contentMatch = /<skill_content\b[^>]*\bname=(['"])(.*?)\1[^>]*>/i.exec(raw)
      const resourcesMatch = /<skill_resources>\s*([\s\S]*?)\s*<\/skill_resources>/i.exec(raw)
      const instructionsMatch = /<skill_instructions>\s*([\s\S]*?)\s*<\/skill_instructions>/i.exec(raw)
      if (!instructionsMatch) return null
      const name = (contentMatch && contentMatch[2].trim()) || requestedName || 'skill'
      const resources = resourcesMatch ? resourcesMatch[1].trim() : ''
      const baseMatch = /^Base directory for this skill:\s*(.+)$/mi.exec(resources)
      const baseDir = baseMatch ? baseMatch[1].trim() : ''
      const resourceNote = resources.replace(/^Base directory for this skill:\s*.+(?:\r?\n)?/mi, '').trim()
      return { name, raw, instructions: instructionsMatch[1].trim(), baseDir, resourceNote }
    }

    const skillDetailRail = (c, anim, st) => {
      const skill = skillDetailOf(c)
      if (!skill) return null
      const cap = 16000
      const instructions = skill.instructions.length > cap ? skill.instructions.slice(0, cap) + '\n…(, ' + skill.instructions.length + ' )' : skill.instructions
      const raw = skill.raw.length > cap ? skill.raw.slice(0, cap) + '\n…(, ' + skill.raw.length + ' )' : skill.raw
      return '<div class="fl-rail' + (anim ? ' fl-rail-anim' : '') + '" data-flow-markdown-detail="1"><div class="fl-rail-resize" title="' + tHost(st, 'dragResize') + '"></div>' +
        '<div class="fl-rail-head"><span class="fl-rail-title">' + esc(tHost(st, 'skillDetailTitle', skill.name)) + '</span>' +
        '<button type="button" class="fl-rail-x" data-action="fdetail" data-seq="' + c.seq + '" title="' + tHost(st, 'closeDetail') + '">✕</button></div>' +
        '<div class="fl-rail-body" data-flow-markdown-body="1" data-flow-markdown-key="' + c.seq + '" data-flow-markdown-streaming="0">' +
          '<div class="fl-skill-hero"><span class="fl-tag">' + getKindMeta('skill').label + '</span><strong>' + esc(skill.name) + '</strong>' + statusGlyph(c.status, c.dur) + '</div>' +
          (skill.baseDir ? '<div class="fl-skill-field"><span>' + tHost(st, 'baseDir') + '</span><code>' + esc(skill.baseDir) + '</code></div>' : '') +
          (skill.resourceNote ? '<div class="fl-sec"><div class="fl-sec-head"><span class="fl-sec-label">' + tHost(st, 'resourceNote') + '</span>' + copyButtonHtml(st) + '</div><pre class="fl-pre">' + esc(skill.resourceNote) + '</pre></div>' : '') +
          '<div class="fl-sec fl-skill-instructions"><div class="fl-sec-head"><span class="fl-sec-label">' + tHost(st, 'usageInstructions') + '</span>' + markdownPreviewButtonHtml(c.seq, st) + copyButtonHtml(st) + '</div>' +
          '<pre class="fl-pre" data-flow-markdown-source="1">' + esc(instructions || tHost(st, 'emptyMsg')) + '</pre></div>' +
          '<details class="fl-skill-raw"><summary>' + tHost(st, 'rawReturn') + '</summary><div class="fl-sec"><div class="fl-sec-head"><span class="fl-sec-label">' + tHost(st, 'fullXml', skill.raw.length > cap) + '</span>' + copyButtonHtml(st) + '</div><pre class="fl-pre">' + esc(raw || tHost(st, 'emptyMsg')) + '</pre></div></details>' +
        '</div></div>'
    }

    //  → (:/,):
    // ( JSON)+ (, HTML); ✕
    const detailRail = (c, anim, presentationRules, st) => {
      const skill = skillDetailRail(c, anim, st)
      if (skill) return skill
      const identity = displayIdentity(c, presentationRules, st)
      let input = c.argsRaw || ''
      try { input = JSON.stringify(JSON.parse(c.argsRaw || '{}'), null, 2) } catch (e) {}
      const cap = 8000
      const inShown = input.length > cap ? input.slice(0, cap) + '\n…(, ' + input.length + ' )' : input
      const out = c.status === 'pending' ? tHost(st, 'inProgressNoReturn') : (c.resultText || tHost(st, 'emptyReturn'))
      const outShown = out.length > cap ? out.slice(0, cap) + '\n…(, ' + out.length + ' )' : out
      // anim=(,)
      return '<div class="fl-rail' + (anim ? ' fl-rail-anim' : '') + '"><div class="fl-rail-resize" title="' + tHost(st, 'dragResize') + '"></div>' +
        '<div class="fl-rail-head"><span class="fl-rail-title">' + esc(identity.name) + tHost(st, 'detail') + '</span>' +
        '<button type="button" class="fl-rail-x" data-action="fdetail" data-seq="' + c.seq + '" title="' + tHost(st, 'closeDetail') + '">✕</button></div>' +
        '<div class="fl-rail-body">' +
          '<div class="fl-sec"><div class="fl-sec-head"><span class="fl-sec-label">' + tHost(st, 'fullInput', input.length > cap) + '</span>' + copyButtonHtml(st) + '</div><pre class="fl-pre">' + esc(inShown) + '</pre></div>' +
          '<div class="fl-sec"><div class="fl-sec-head"><span class="fl-sec-label">' + tHost(st, 'fullOutput', c.outLen ? fmtSize(c.outLen) : '') + '</span>' + copyButtonHtml(st) + '</div><pre class="fl-pre">' + esc(outShown) + '</pre></div>' +
        '</div>' +
      '</div>'
    }

    // (//): + //tokens  + ()
    const msgRail = (it, anim, st) => {
      const label = it.role === 'user' ? tHost(st, 'userMsg') : it.role === 'ai' ? tHost(st, 'aiMsg') : tHost(st, 'injectMsg')
      const cap = 8000
      const full = String(it.full || it.preview || '')
      const shown = full.length > cap ? full.slice(0, cap) + '\n…(, ' + full.length + ' )' : full
      const meta = []
      if (fmtTime(it.time)) meta.push(tHost(st, 'timeLabel', fmtTime(it.time)))
      if (it.route) meta.push(tHost(st, 'modelLabel', it.route))
      if (it.attemptId) meta.push('attempt ' + String(it.attemptId).slice(0, 12))
      if (it.tok) meta.push(tHost(st, 'tokLabel', it.tok))
      if (it.finishKind && it.finishKind !== 'stop') meta.push(tHost(st, 'finishKindLabel', it.finishKind))
      if (it.failCode) meta.push(tHost(st, 'errorLabel', it.failCode, it.failMsg ? oneLine(it.failMsg, 80) : ''))
      if (it.retries && it.retries.length) meta.push(tHost(st, 'retriesLabel', it.retries.length, it.retries.map((r) => r.code || '?').join(' → ')))
      // :( data-flow-branch )
      const branch = it.role === 'ai' && !it.streaming
        ? '<button type="button" class="fl-branch-btn" data-flow-branch data-seq="' + (it.finalSeq != null ? it.finalSeq : it.seq) + '" title="' + tHost(st, 'branchHarness') + '" aria-label="' + tHost(st, 'branchAria') + '">' +
          '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3v5a3 3 0 0 0 3 3h4"/><path d="M8 5l3-3 3 3"/><path d="M11 2v4"/><path d="M9 9l2 2-2 2"/></svg></button>'
        : ''
      const markdown = it.role === 'ai'
      return '<div class="fl-rail' + (anim ? ' fl-rail-anim' : '') + '"' + (markdown ? ' data-flow-markdown-detail="1"' : '') + '><div class="fl-rail-resize" title="' + tHost(st, 'dragResize') + '"></div>' +
        '<div class="fl-rail-head"><span class="fl-rail-title">' + label + tHost(st, 'detail') + '</span>' + branch +
        '<button type="button" class="fl-rail-x" data-action="fdetail" data-seq="' + it.seq + '" title="' + tHost(st, 'closeDetail') + '">✕</button></div>' +
        '<div class="fl-rail-body"' + (markdown ? ' data-flow-markdown-body="1" data-flow-markdown-key="' + it.seq + '" data-flow-markdown-streaming="' + (it.streaming ? '1' : '0') + '"' : '') + '>' +
          (meta.length ? '<div class="fl-sec"><span class="fl-sec-label">' + esc(meta.join(' · ')) + '</span></div>' : '') +
          '<div class="fl-sec"><div class="fl-sec-head"><span class="fl-sec-label">' + tHost(st, 'fullContent', full.length > cap) + '</span>' + (markdown ? markdownPreviewButtonHtml(it.seq, st) : '') + copyButtonHtml(st) + '</div><pre class="fl-pre"' + (markdown ? ' data-flow-markdown-source="1"' : '') + '>' + esc(shown || tHost(st, 'emptyMsg')) + '</pre></div>' +
        '</div>' +
      '</div>'
    }

    const presentationRulesRail = (st, anim) => {
      const value = JSON.stringify(st.presentationRules || [], null, 2)
      const example = '[\n  {\n    "enabled": true,\n    "tools": ["pwsh"],\n    "executables": ["engram-memory.ps1"],\n    "displayName": "engram-lattice",\n    "actions": ["search", "recall", "memory"],\n    "badge": "",\n    "color": "#81c784"\n  }\n]'
      const trashIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6 2.5h4l.7 2H5.3l.7-2Z"/><path d="M4.5 4.5l.6 9h5.8l.6-9M7 7v4M9 7v4"/></svg>'
      const chevronIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.5 3.5 4.5 4.5-4.5 4.5"/></svg>'
      const plusIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>'
      const input = (field, value, placeholder) => '<input class="tb-input" data-field="' + field + '" value="' + esc(value) + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '>'
      const fieldsFor = (prefix, rule) => '<div class="fl-rule-grid">' +
        '<label><span>Raw tools</span>' + input(prefix + '.tools', (rule.tools || []).join(', '), 'pwsh, bash') + '</label>' +
        '<label><span>Executables</span>' + input(prefix + '.executables', (rule.executables || []).join(', '), 'tool.ps1, tool') + '</label>' +
        '<label><span>Display name</span>' + input(prefix + '.displayName', rule.displayName || '', 'Optional') + '</label>' +
        '<label><span>Subcommands</span>' + input(prefix + '.actions', (rule.actions || []).join(', '), 'search, recall') + '</label>' +
        '<label><span>Badge</span>' + input(prefix + '.badge', rule.badge || '', 'Optional') + '</label>' +
        '<label><span>Color</span><input class="fl-rule-color" type="color" data-field="' + prefix + '.color" value="' + esc(rule.color || '#81c784') + '"></label>' +
      '</div>'
      const editor = (prefix, rule, saveAction, index) => '<div class="fl-rule-editor">' +
        '<input type="hidden" data-field="' + prefix + '.enabled" value="' + (rule.enabled ? '1' : '0') + '">' + fieldsFor(prefix, rule) +
        '<div class="fl-rule-editor-actions"><button type="button" class="tb-btn tb-btn-sm" data-flow-rule-cancel="1">Cancel</button>' +
        '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-action="' + saveAction + '"' + (index == null ? '' : ' data-index="' + index + '"') + '>Save</button></div></div>'
      const rows = (st.presentationRules || []).map((rule, index) => {
        const title = rule.displayName || 'Unnamed rule'
        const summary = rule.tools.join(', ') + ' · ' + rule.executables.length + ' executables · ' + (rule.actions.length || 'any') + ' subcommands'
        return '<section class="fl-rule-card' + (!rule.enabled ? ' fl-rule-off' : '') + '"><div class="fl-rule-summary">' +
          '<button type="button" class="fl-rule-main" data-flow-rule-edit="1" title="Expand rule to edit" aria-expanded="false">' +
            '<span class="fl-rule-dot" style="background:' + esc(rule.color) + '"></span>' +
            (rule.badge ? '<span class="fl-rule-badge" style="color:' + esc(rule.color) + ';background:' + esc(rule.color) + '1f">' + esc(rule.badge) + '</span>' : '') +
            '<span class="fl-rule-copy"><strong>' + esc(title) + '</strong><small>' + esc(summary) + '</small></span>' +
            '<span class="fl-rule-chevron">' + chevronIcon + '</span></button>' +
          '<button type="button" class="fl-rule-switch' + (rule.enabled ? ' is-on' : '') + '" data-action="ftoggle-rule" data-index="' + index + '" title="' + (rule.enabled ? 'Disable rule' : 'Enable rule') + '" aria-label="' + (rule.enabled ? 'Disable rule' : 'Enable rule') + '" aria-pressed="' + (rule.enabled ? 'true' : 'false') + '"><span></span></button>' +
          '<button type="button" class="fl-rule-icon fl-rule-delete" data-action="fdelete-rule" data-index="' + index + '" title="Delete rule" aria-label="Delete rule">' + trashIcon + '</button></div>' +
          editor('flowRule.' + index, rule, 'fsave-rule', index) + '</section>'
      }).join('')
      const empty = '<div class="tb-notice">No rules configured. Click "Add Rule" or import from JSON.</div>'
      const blank = { tools: [], executables: [], displayName: '', actions: [], badge: '', color: '#81c784' }
      return '<div class="fl-rail' + (anim ? ' fl-rail-anim' : '') + '"><div class="fl-rail-resize" title="' + tHost(st, 'dragResize') + '"></div>' +
        '<div class="fl-rail-head"><span class="fl-rail-title">Flowglass Settings</span><button type="button" class="fl-rule-add" data-flow-rule-new="1" aria-expanded="false">' + plusIcon + '<span>Add Rule</span></button>' +
        '<button type="button" class="fl-rail-x" data-action="fsettings" title="Close Settings">✕</button></div>' +
        '<div class="fl-rail-body">' +
          '<div class="tb-note">Rules project card titles and badges in Flowglass; original tool names, arguments, results, and session logs remain unchanged.</div>' +
          '<div class="fl-rule-list">' + (rows || empty) + '</div>' +
          '<section class="fl-rule-card fl-rule-new"><div class="fl-rule-new-title">New Rule</div>' + editor('flowRule.new', blank, 'fcreate-rule') + '</section>' +
          (st.ruleNotice ? '<div class="tb-note" style="color:var(--tb-done-text,#81c784)">' + esc(st.ruleNotice) + '</div>' : '') +
          '<details class="fl-rule-source"><summary class="tb-note">JSON Source</summary><textarea class="tb-textarea" spellcheck="false" data-field="flowPresentationRules" placeholder="' + esc(example) + '">' + esc(value) + '</textarea>' +
          '<div class="tb-row"><button type="button" class="tb-btn tb-btn-sm" data-action="fapply-rule-json">Apply from JSON</button>' + ((st.presentationRules || []).length ? '<button type="button" class="tb-btn tb-btn-sm" data-action="freset-rules">Clear all</button>' : '') + '</div></details>' +
        '</div></div>'
    }

    // ():()+ ()+
    //  = (pending) live—— fl-live(//)
    const subBranchHtml = async (c, st) => {
      const cid = childIdOf(c)
      let subLive = c.status === 'pending'
      let sub2 = null
      if (cid) {
        try { sub2 = await childRows(cid, 10); if (sub2.live) subLive = true } catch (e) {}
      }

      //  id ,“”;
      // ,.
      let sub = '<div class="fl-sub-card fl-sub-open' + (subLive ? ' fl-live' : '') + '" data-action="' + (cid ? 'fenter' : 'fdetail') + '" data-seq="' + c.seq + '" data-flow-select-seq="' + c.seq + '" title="' + (cid ? tHost(st, 'subagentTitleEnter') : tHost(st, 'subagentTitleTask')) + '">' +
        '<div class="fl-iohead"><span class="fl-tag" style="color:var(--tb-active-text,#7fa7f0);background:rgba(91,141,239,.12)">' + tHost(st, 'subagentTag') + '</span>' +
        '<span class="fl-name">' + esc(c.name) + '</span>' + statusGlyph(c.status, c.dur) + '</div>' +
        '<div class="fl-sub-io"><span class="fl-io-tag">' + 'In' + '</span><span class="fl-branch-txt">' + esc(inSummary(c, st)) + '</span></div>' +
      '</div>'
      let steps = ''
      if (cid && sub2) {
        steps += '<div class="fl-sub-meta"><span class="fl-time">↳ ' + esc(cid.slice(0, 8)) + '… · ' + sub2.total + ' steps' + '</span>' + (sub2.live ? '<span class="fl-tag" style="color:var(--tb-done-text,#81c784)">' + tHost(st, 'running') + '</span>' : '') +
          '<button type="button" class="tb-btn tb-btn-sm" data-action="fenter" data-seq="' + c.seq + '" title="' + tHost(st, 'subagentFullFlow') + '">' + tHost(st, 'enterArrow') + '</button></div>'
        for (const r of sub2.rows) {
          steps += '<div class="fl-sub-step">' +
            (r.pill ? '<span class="fl-branch-pill">' + esc(r.pill) + '</span>' : '') +
            '<span class="fl-branch-txt' + (r.pill ? '' : ' fl-branch-ai') + '">' + esc(r.txt) + '</span>' +
            (r.pill ? statusGlyph(r.status, r.dur) : '') +
          '</div>'
        }
        if (sub2.total > sub2.rows.length) steps += '<div class="fl-sub-step"><span class="fl-time">… ' + (sub2.total - sub2.rows.length) + ' earlier steps not expanded' + '</span></div>'
      } else if (c.status === 'pending') {
        steps = '<div class="fl-sub-step"><span class="fl-time">' + tHost(st, 'subagentStarting') + '</span></div>'
      }
      if (steps) sub += '<div class="fl-sub-steps">' + steps + '</div>'
      if (c.status !== 'pending') {
        const o = outSummary(c, st)
        sub += '<div class="fl-sub-card fl-sub-close" data-action="fdetail" data-seq="' + c.seq + '" title="' + tHost(st, 'subagentTitleTask') + '">' +
          '<div class="fl-sub-io"><span class="fl-io-tag">' + 'Out' + '</span>' +
          '<span class="fl-time">' + fmtDur(c.dur) + '</span>' +
          (o ? '<span class="fl-args">' + esc(o.text) + '</span>' : '') + '</div>' +
        '</div>'
      }
      return sub
    }

    const flowContextOf = (items, seqs, sid) => {
      const wanted = new Set(seqs)
      const selected = items.filter((it) => wanted.has(it.seq)).sort((a, b) => a.seq - b.seq)
      const chunks = ['Flowglass export for ' + sid + ' (' + selected.length + ' items):']
      for (const it of selected) {
        if (it.kind === 'msg') {
          const role = it.role === 'user' ? 'User' : it.role === 'ai' ? 'Assistant' : 'System'
          chunks.push('\n[' + role + ' · seq ' + it.seq + ']\n' + String(it.full || it.preview || '(no content)'))
        } else {
          chunks.push('\n[Tool ' + it.name + ' · seq ' + it.seq + ']\nInput: ' + (it.argsRaw || '(no content)') + '\nOutput: ' + (it.status === 'pending' ? 'Running' : (it.resultText || '(no content)')))
        }
      }
      const text = chunks.join('\n')
      const cap = 24000
      return {
        sourceSessionId: sid,
        seqs: selected.map((it) => it.seq),
        text: text.length > cap ? text.slice(0, cap) + '\n…(,)' : text,
      }
    }

    // :,,.
    const subGroupHtml = async (node, st) => {
      const branches = await Promise.all(node.calls.map((c) => subBranchHtml(c, st)))
      const label = 'Parallel subagents ×'
      return (node.calls.length > 1 ? '<span class="fl-subgrp-tag">' + label + node.calls.length + '</span>' : '') +
        branches.map((html) => '<div class="fl-subbranch">' + html + '</div>').join('')
    }

    const subColHtml = (node, html) => '<div class="fl-subcol' + (node.calls.length > 1 ? ' fl-subgrp' : '') + '">' + html + '</div>'

    // :(→).
    const renderFlowNodeRows = async (nodes, st, liveAiSeq) => {
      const subHtmls = {}
      await Promise.all(nodes.map(async (n, i) => { if (n.t === 'subs') subHtmls[i] = await subGroupHtml(n, st) }))
      const rows = []
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        const withConn = rows.length > 0
        let h
        if (n.t === 'msg' && n.it.role === 'ai' && nodes[i + 1] && (nodes[i + 1].t === 'par' || nodes[i + 1].t === 'subs')) {
          let parN = null, subN = null, subIdx = -1, next = i + 1
          if (nodes[next] && nodes[next].t === 'par') { parN = nodes[next]; next++ }
          if (nodes[next] && nodes[next].t === 'subs') { subN = nodes[next]; subIdx = next; next++ }
          if (!parN && nodes[next] && nodes[next].t === 'par') { parN = nodes[next]; next++ }
          const subCalls = subN ? subN.calls : []
          const aiLive = (parN && parN.calls.some((c) => c.status === 'pending')) || subCalls.some((c) => c.status === 'pending') || n.it.seq === liveAiSeq
          let main = msgCardInner(n.it, st.expanded, aiLive, st)
          let lastI = next - 1
          const allSettled = subCalls.length > 0 && subCalls.every((c) => c.resSeq != null)
          const resultSeq = allSettled ? Math.max(...subCalls.map((c) => c.resSeq)) : null
          if (resultSeq != null) {
            for (let j = next; j < nodes.length; j++) {
              const m = nodes[j]
              if (m.t !== 'msg') break
              if (subN.turn != null && m.it.turn != null && m.it.turn !== subN.turn) break
              main += '<span class="fl-arrow">▼</span>' + msgCardInner(m.it, st.expanded, m.it.seq === liveAiSeq, st)
              lastI = j
              if (m.it.seq > resultSeq) break
            }
          }
          h = '<div class="fl-lane">' +
            (subN ? subColHtml(subN, subHtmls[subIdx] || '') : '<div></div>') +
            '<div class="fl-lane-main">' + connMain(main, withConn) + '</div>' +
            (parN ? grpSide(parN, parN.calls.map((c) => renderCallWire(c, st.expanded, st.presentationRules, st)).join(''), st) : '<div></div>') +
          '</div>'
          i = lastI
        } else if (n.t === 'msg') h = renderMsg(n.it, st.expanded, withConn, n.it.seq === liveAiSeq, st)
        else if (n.t === 'par') h = renderPar(n, st.expanded, st.presentationRules, st)
        else h = '<div class="fl-lane">' + subColHtml(n, subHtmls[i] || '') + '<div class="fl-lane-main"><span class="fl-lane-line"></span></div><div></div></div>'
        rows.push(h)
      }
      return rows
    }

    // ---- : + (llm )----
    const ai = makeLlmHelper(ctx)
    const zoomLlm = ctx.get('llm')
    let zoomRoutesCache = null
    const buildZoomRoutes = async () => {
      if (zoomRoutesCache) return zoomRoutesCache
      const routes = []
      try {
        const providers = await ai.listProviders()
        for (const p of providers) {
          const models = await ai.listModels(p.id)
          for (const m of models) {
            let reasoning = null
            try {
              const info = zoomLlm && typeof zoomLlm.resolveModelInfo === 'function'
                ? await zoomLlm.resolveModelInfo(p.id, m.id)
                : null
              reasoning = info && info.reasoning ? info.reasoning : null
            } catch (e) {}
            routes.push({
              value: p.id + '/' + m.id,
              label: (p.name || p.id) + ' / ' + (m.name || m.id),
              efforts: reasoning && Array.isArray(reasoning.efforts)
                ? reasoning.efforts.map((x) => ({ id: String(x.id), name: x.name || String(x.id) }))
                : [],
              defaultEffort: reasoning && reasoning.defaultEffort != null ? String(reasoning.defaultEffort) : '',
            })
          }
        }
      } catch (e) {}
      zoomRoutesCache = routes
      return routes
    }
    try { ctx.on('llm/adapters-updated', () => { zoomRoutesCache = null }) } catch (e) {}

    // ----  Zoom:()=====
    // :tree=( + ,);
    // live=Harness ().: +
    // ( ▲ /  ◆ / ,,)+ ;
    // (crumb  zoom ,"← "), Harness .
    // " + "(), 2s .
    const ZOOM_CAP = 12
    const ZOOM_STRIP = 16
    const zoomCache = {} // sid → { key, data }
    const zoomGrowth = {} // sid → (agents , growth )
    const hashText = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36) }

    // “”, history  + .
    const normalizeZoomRuns = (value) => {
      if (!Array.isArray(value)) return []
      const out = []
      for (const raw of value.slice(-20)) {
        if (!raw || typeof raw !== 'object') continue
        const id = typeof raw.id === 'string' && /^[\w-]{1,80}$/.test(raw.id) ? raw.id : ''
        const legacySids = Array.isArray(raw.sids) ? raw.sids.map(String).filter((s) => /^[\w-]{1,80}$/.test(s)).slice(0, 4) : []
        const rounds = []
        const sourceRounds = Array.isArray(raw.rounds) && raw.rounds.length ? raw.rounds : (legacySids.length ? [{ id: id + '-round-1', kind: 'round', at: raw.at, prompt: raw.prompt, sids: legacySids, routes: raw.routes, efforts: raw.efforts, sourceSids: [] }] : [])
        for (let i = 0; i < sourceRounds.length; i++) {
          const rr = sourceRounds[i] || {}
          const sids = Array.isArray(rr.sids) ? [...new Set(rr.sids.map(String).filter((s) => /^[\w-]{1,80}$/.test(s)))].slice(0, 4) : []
          if (!sids.length) continue
          rounds.push({
            id: typeof rr.id === 'string' && /^[\w-]{1,100}$/.test(rr.id) ? rr.id : id + '-round-' + (i + 1),
            kind: rr.kind === 'initial' ? 'initial' : 'round',
            at: Number.isFinite(Number(rr.at)) ? Number(rr.at) : 0,
            prompt: typeof rr.prompt === 'string' ? rr.prompt.slice(0, 240) : '',
            sourceSids: Array.isArray(rr.sourceSids) ? [...new Set(rr.sourceSids.map(String).filter((s) => /^[\w-]{1,80}$/.test(s)))].slice(0, 4) : [],
            sids,
            routes: Array.isArray(rr.routes) ? rr.routes.map(String).slice(0, sids.length) : [],
            efforts: Array.isArray(rr.efforts) ? rr.efforts.map(String).slice(0, sids.length) : [],
          })
        }
        if (!id || !rounds.length) continue
        const last = rounds[rounds.length - 1]
        out.push({
          id,
          at: Number.isFinite(Number(raw.at)) ? Number(raw.at) : 0,
          prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, 240) : '',
          name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 40) : '',
          parentId: typeof raw.parentId === 'string' ? raw.parentId : '',
          forkRoundId: typeof raw.forkRoundId === 'string' ? raw.forkRoundId : '',
          rounds,
          sids: last.sids,
          routes: last.routes,
          efforts: last.efforts,
        })
      }
      for (let i = 0; i < out.length; i++) if (!out[i].name) out[i].name = ' ' + String.fromCharCode(65 + (i % 26))
      return out
    }

    const zoomTopology = (history) => {
      const rounds = history && Array.isArray(history.rounds) ? history.rounds : []
      if (!rounds.length) return ''
      const nums = [rounds[0].sids.length]
      for (let i = 1; i < rounds.length; i++) {
        const r = rounds[i]
        const sourceCount = r.sourceSids.length || nums[nums.length - 1]
        if (sourceCount !== nums[nums.length - 1]) nums.push(sourceCount)
        nums.push(r.sids.length)
      }
      return nums.join('→')
    }

    //  Harness ,.
    // ,, activeId.
    const latestZoomRunForSession = (runs, sid) => {
      if (!sid) return null
      let best = null
      for (let runIndex = 0; runIndex < runs.length; runIndex++) {
        const run = runs[runIndex]
        const rounds = Array.isArray(run.rounds) ? run.rounds : []
        // initial “ Session ”, Session .
        const memberRounds = rounds.filter((round) => round.kind !== 'initial' && round.sids.includes(sid))
        const sourceRounds = rounds.filter((round) => round.sourceSids.includes(sid) || (round.kind === 'initial' && round.sids.includes(sid)))
        if (!memberRounds.length && !sourceRounds.length) continue
        // “ Session ”; 1→N ,
        //  Session.,.
        const membership = memberRounds.length ? 1 : 0
        const round = membership ? memberRounds[memberRounds.length - 1] : sourceRounds[sourceRounds.length - 1]
        const score = Number(round && round.at) || Number(run.at) || 0
        if (!best || membership > best.membership || (membership === best.membership && (score > best.score || (score === best.score && runIndex > best.runIndex)))) {
          best = { run, round, score, runIndex, membership }
        }
      }
      return best
    }

    const agentRunning = (sid) => {
      try {
        const agentsSvc = ctx.get('agents')
        if (!agentsSvc || typeof agentsSvc.get !== 'function') return null // :
        const a = agentsSvc.get(sid)
        return !!(a && a.status === 'running')
      } catch (e) { return null }
    }
    const sessionLive = (sid) => {
      try {
        const ss = ctx.get('sessions')
        return !!(ss && typeof ss.get === 'function' && ss.get(sid))
      } catch (e) { return false }
    }

    // :(,""),
    // ///tok , ZOOM_STRIP  glyph ()
    const boardSummary = async (sid, rulesKey, rules) => {
      const r = await readLog(sid)
      const prev = zoomGrowth[sid]
      zoomGrowth[sid] = r.count || 0
      const grew = prev != null && (r.count || 0) > prev
      const key = (r.count || 0) + ':' + rulesKey
      const hit = zoomCache[sid]
      if (hit && hit.key === key) return { ...hit.data, grew }
      const items = parseItems(r.events || [])
      let tools = 0, toolErr = 0, tok = 0, lastTime = 0, title = '', route = '', hasSubagent = false
      const strip = []
      for (const it of items) {
        if (typeof it.time === 'number' && it.time > lastTime) lastTime = it.time
        if (it.kind === 'msg') {
          if (it.role === 'user') { if (!title && it.preview) title = it.preview; strip.push({ g: 'user', txt: it.preview }) }
          else if (it.role === 'ai') { if (it.tok) tok += it.tok; if (it.route) route = it.route; strip.push({ g: 'ai', txt: it.preview }) }
          else strip.push({ g: 'sys', txt: it.preview })
        } else {
          tools++
          if (it.cat === 'subagent') hasSubagent = true
          if (it.status === 'error') toolErr++
          const identity = displayIdentity(it, rules)
          strip.push({ g: 'tool', name: identity.name, status: it.status, color: identity.meta.color, bg: identity.meta.bg, txt: inSummary(it) })
        }
      }
      const data = { sid, nodes: items.length, tools, toolErr, tok, lastTime, title, route, hasSubagent, strip: strip.slice(-ZOOM_STRIP), stripTotal: strip.length }
      zoomCache[sid] = { key, data }
      return { ...data, grew }
    }

    // :tree= + (SessionLineageNode ,);
    // live=sessions.list() .trace / home( sessions).
    // run=,;tree=.
    const collectZoomSessions = async (st, home) => {
      const out = []
      const seen = new Set()
      const archived = st.__archivedSessionIds instanceof Set ? st.__archivedSessionIds : new Set()
      const recordTitle = (rec) => {
        const header = rec && rec.header
        return String((rec && (rec.title || rec.name)) || (header && (header.title || header.name)) || '')
      }
      const fleetTitle = (title) => {
        const m = String(title || '').match(/^⚡\s*(.*?)\s*·\s*\s*(\d+)\s*\/\s*(\d+)(?:\s*·.*)?$/)
        if (!m) return null
        const index = Number(m[2]), total = Number(m[3])
        return index >= 1 && total >= 2 && index <= total ? { prompt: m[1].trim(), index, total } : null
      }
      const push = (rec, depth) => {
        const header = (rec && rec.header) || null
        const sid2 = header && header.id ? String(header.id) : ''
        if (!sid2 || seen.has(sid2) || archived.has(sid2)) return
        seen.add(sid2)
        out.push({ sid: sid2, header, live: !!(rec && rec.live), persisted: !!(rec && rec.persisted), depth,
          fleetPeer: !!(rec && rec.fleetPeer), fleetPrompt: rec && rec.fleetPrompt ? String(rec.fleetPrompt) : '' })
      }
      if (st.zoomScope === 'run') {
        const run = st.zoomRuns.find((x) => x.id === st.zoomRunId) || st.zoomRuns[st.zoomRuns.length - 1]
        const round = run && (run.rounds.find((x) => x.id === st.zoomRoundId) || run.rounds[run.rounds.length - 1])
        for (const runSid of (round && round.sids) || []) {
          let header = null
          try { const ss = ctx.get('sessions'); const s = ss && typeof ss.get === 'function' ? ss.get(runSid) : null; if (s) header = s.header || null } catch (e) {}
          if (!header) { try { const rr = await readLog(runSid); header = { ...((rr && rr.header) || {}), id: runSid } } catch (e) { header = { id: runSid } } }
          push({ header, live: sessionLive(runSid), persisted: true }, 0)
          const rec = out[out.length - 1]
          if (rec && rec.sid === runSid) rec.fleet = true
        }
      } else {
        if (home && sq && typeof sq.traceSession === 'function') {
          try {
            let tr = await sq.traceSession(home)
            // traceSession(home).descendants .,
            // ; ancestors  trace,.
            const ancestors = tr && Array.isArray(tr.ancestors) ? tr.ancestors : []
            const rootRec = ancestors.length ? ancestors[ancestors.length - 1] : null
            const rootSid = rootRec && rootRec.header && rootRec.header.id ? String(rootRec.header.id) : ''
            if (rootSid && rootSid !== home) {
              try { tr = await sq.traceSession(rootSid) } catch (e) {}
            }
            push(tr && tr.target, 0)
            const walk = (nodes, d) => { for (const n of nodes || []) { push(n && n.session, d); walk(n && n.descendants, d + 1) } }
            walk(tr && tr.descendants, 1)
          } catch (e) {}
        }
        if (!seen.has(home) && home) out.unshift({ sid: home, header: null, live: sessionLive(home), persisted: false, depth: 0 })
        // Harness  Session  subagent,traceSession ;
        // “⚡ <> ·  i/n · <>”.,
        // ,, Session .
        if (out.length <= 1) {
          try {
            const clientIndex = Array.isArray(st.__zoomSessionIndex) ? st.__zoomSessionIndex : []
            const recent = clientIndex.length
              ? clientIndex
              : (sq && typeof sq.listSessions === 'function' ? await sq.listSessions() : [])
            const current = (recent || []).find((x) => String((x && (x.id || (x.header || {}).id)) || '') === home)
            let meta = fleetTitle(recordTitle(current))
            if (!meta) {
              const rr = await readLog(home)
              meta = fleetTitle(recordTitle(rr))
            }
            if (meta) {
              const matches = []
              for (const item of recent || []) {
                const parsed = fleetTitle(recordTitle(item))
                const itemSid = String((item && (item.id || (item.header || {}).id)) || '')
                if (!itemSid || !parsed || parsed.prompt !== meta.prompt || parsed.total !== meta.total) continue
                matches.push({ item, sid: itemSid, index: parsed.index })
              }
              // ;.
              const unique = []
              const indexes = new Set()
              for (const hit of matches) if (!indexes.has(hit.index)) { indexes.add(hit.index); unique.push(hit) }
              if (unique.length >= 2 && unique.some((x) => x.sid === home)) {
                unique.sort((a, b) => a.index - b.index)
                out.length = 0; seen.clear()
                for (const hit of unique) {
                  const rawHeader = (hit.item && hit.item.header) || {}
                  push({ header: { ...rawHeader, id: hit.sid, title: recordTitle(hit.item) }, live: sessionLive(hit.sid), persisted: true, fleetPeer: true, fleetPrompt: meta.prompt }, 1)
                  const added = out[out.length - 1]
                  if (added && added.sid === hit.sid) added.fleet = true
                }
              }
            }
          } catch (e) {}
        }
      }
      return out
    }

    // : ZOOM_FLOW ,(,);
    //  + (git ), + ✓/✗/
    const ZOOM_FLOW = 8
    const zoomFlowHtml = (sum) => {
      const flow = sum.strip.slice(-ZOOM_FLOW)
      const rows = flow.map((e) => {
        if (e.g === 'tool') {
          const cls = e.status === 'error' ? ' fl-zoom-tool-err' : e.status === 'pending' ? ' fl-zoom-tool-pending' : ''
          return '<div class="fl-zoom-step">' +
            '<span class="fl-zoom-tool' + cls + '" style="color:' + e.color + ';background:' + e.bg + '" title="' + esc(e.name + (e.txt ? ' · ' + e.txt : '') + (e.status === 'error' ? ' (failed)' : e.status === 'pending' ? ' (running)' : '')) + '">' + esc(e.name) + '</span>' +
            '<span class="fl-zoom-step-txt">' + esc(oneLine(e.txt || '', 24)) + '</span>' +
            (e.status === 'pending' ? '<span class="fl-spin"></span>' : e.status === 'error' ? '<span class="fl-zoom-step-err">✗</span>' : '<span class="fl-zoom-step-ok">✓</span>') +
          '</div>'
        }
        const glyph = e.g === 'user' ? '▲' : e.g === 'ai' ? '◆' : '■'
        const color = e.g === 'user' ? 'var(--tb-done-text,#81c784)' : e.g === 'ai' ? 'var(--tb-active-text,#7fa7f0)' : 'var(--tb-text-3,#777884)'
        const label = e.g === 'user' ? 'User' : e.g === 'ai' ? 'Assistant' : 'System'
        return '<div class="fl-zoom-step"><span class="fl-zoom-glyph" style="color:' + color + '" title="' + label + '">' + glyph + '</span>' +
          '<span class="fl-zoom-step-txt">' + esc(oneLine(e.txt || '', 26)) + '</span></div>'
      }).join('')
      const more = sum.stripTotal > flow.length ? '<div class="fl-zoom-step"><span class="fl-zoom-more">…  ' + (sum.stripTotal - flow.length) + ' </span></div>' : ''
      return '<div class="fl-zoom-flow">' + more + rows + '</div>'
    }

    // : turn ,;/.
    const buildZoomTurnCompare = async (branches) => {
      const perSession = new Map()
      const turnSet = new Set()
      const fileRefs = (raw) => {
        const out = []
        try {
          const value = JSON.parse(raw || '{}')
          const walk = (v, key) => {
            if (typeof v === 'string') {
              if (/(?:file|path|cwd|root|target)/i.test(key || '') || /(?:[A-Za-z]:[\\/]|\/)[^\s"']+/.test(v)) out.push(v.replace(/\\/g, '/'))
            } else if (Array.isArray(v)) for (const x of v) walk(x, key)
            else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], k)
          }
          walk(value, '')
        } catch (e) {}
        return out
      }
      await Promise.all(branches.map(async (c) => {
        const grouped = new Map()
        try {
          const r = await readLog(c.rec.sid)
          for (const it of parseItems(r.events || [])) {
            if (!Number.isFinite(Number(it.turn))) continue
            const turn = Number(it.turn)
            let row = grouped.get(turn)
            if (!row) { row = { input: [], tools: [], files: [], result: [], items: [] }; grouped.set(turn, row) }
            row.items.push(it)
            if (it.kind === 'call') {
              row.tools.push(it.name + ':' + it.status)
              row.files.push(...fileRefs(it.argsRaw || ''))
            }
            else if (it.role === 'user') row.input.push(oneLine(it.full || it.preview || '', 160))
            else if (it.role === 'ai') row.result.push(oneLine(it.full || it.preview || '', 200))
          }
        } catch (e) {}
        for (const turn of grouped.keys()) turnSet.add(turn)
        perSession.set(c.rec.sid, grouped)
      }))
      const turns = [...turnSet].sort((a, b) => a - b)
      const norm = (xs) => xs.join('\n').replace(/\s+/g, ' ').trim()
      const rows = turns.map((turn) => {
        const values = branches.map((c) => {
          const raw = perSession.get(c.rec.sid).get(turn)
          return raw ? { input: norm(raw.input), tools: norm(raw.tools), files: [...new Set(raw.files)].sort().join('\n'), result: norm(raw.result), items: raw.items } : null
        })
        const dimension = (key) => {
          if (values.some((v) => !v)) return ''
          return new Set(values.map((v) => v[key])).size === 1 ? 'same' : 'changed'
        }
        const dims = { input: dimension('input'), flow: dimension('tools'), files: dimension('files'), result: dimension('result') }
        // ;“”,.
        return { turn, values, dims, same: !values.some((v) => !v) && dims.input === 'same' && dims.flow === 'same' && dims.files === 'same' }
      })
      return { rows, branches, perSession }
    }

    const renderZoom = async (st, sid, live) => {
      const home = st.home || sid
      await loadManifestTools()
      const rules = Array.isArray(st.presentationRules) ? st.presentationRules : []
      const rulesKey = hashText(JSON.stringify(rules))
      const recs = await collectZoomSessions(st, home)
      // ( await ,)
      const cards = await Promise.all(recs.map(async (rec) => {
        let sum = null
        try { sum = await boardSummary(rec.sid, rulesKey, rules) } catch (e) {}
        const ar = agentRunning(rec.sid)
        const running = ar === true || (ar === null && !!(sum && sum.grew))
        const live = running || rec.live || sessionLive(rec.sid)
        return { rec, sum, running, live }
      }))
      //  = ( DFS /  / ),:
      //  2s (/,)
      const total = cards.length
      const runningCount = cards.filter((c) => c.running).length
      const shownCards = cards.slice(0, ZOOM_CAP)
      const bySid = new Map(shownCards.map((c) => [c.rec.sid, c]))
      // :tree ;run .
      // tree (depth=0), Session; selectedCard .
      const inferredFleet = st.zoomScope === 'tree' && shownCards.some((c) => c.rec.fleetPeer)
      const inferredFleetPrompt = inferredFleet ? ((shownCards.find((c) => c.rec.fleetPrompt) || {}).rec || {}).fleetPrompt : ''
      const rootC = st.zoomScope === 'tree' && !inferredFleet ? (shownCards.find((c) => c.rec.depth === 0) || bySid.get(home) || null) : null
      const allBranches = rootC ? shownCards.filter((c) => c !== rootC) : shownCards
      const activeRun = st.zoomRuns.find((x) => x.id === st.zoomRunId) || st.zoomRuns[st.zoomRuns.length - 1] || null
      const activeRound = activeRun && (activeRun.rounds.find((x) => x.id === st.zoomRoundId) || activeRun.rounds[activeRun.rounds.length - 1])
      // :;
      // . selectedSid, zoomMode.
      // tree  rootC  Session:,,
      // allBranches. allBranches ,"" disabled.
      const selectableCards = rootC ? shownCards : allBranches
      // (fzoom ,):;
      // (/,),.
      if (st.zoomAutoMode) {
        delete st.zoomAutoMode
        st.zoomMode = shownCards.length > 1 ? 'panorama' : 'near'
        st.zoomMotion = shownCards.length > 1 ? 'overview' : 'focus'
      }
      const nearMode = st.zoomMode === 'near'
      //  st.sid,“”.
      //  Session  sourceSids, activeRound.sids ;.
      let selectedCard = nearMode && st.sid ? (selectableCards.find((c) => c.rec.sid === st.sid) || null) : null
      if (!selectedCard && !nearMode && typeof st.zoomFocusSid === 'string') selectedCard = selectableCards.find((c) => c.rec.sid === st.zoomFocusSid) || null
      if (!selectedCard && st.sid) selectedCard = selectableCards.find((c) => c.rec.sid === st.sid) || null
      if (!selectedCard && nearMode && st.sid) {
        let header = null
        try { const rr = await readLog(st.sid); header = { ...((rr && rr.header) || {}), id: st.sid } } catch (e) { header = { id: st.sid } }
        let sum = null
        try { sum = await boardSummary(st.sid, rulesKey, rules) } catch (e) {}
        selectedCard = { rec: { sid: st.sid, header, live: sessionLive(st.sid), persisted: true, depth: 0 }, sum, running: agentRunning(st.sid) === true, live: sessionLive(st.sid) }
      }
      if (!selectedCard) selectedCard = selectableCards[0] || null
      st.zoomFocusSid = selectedCard ? selectedCard.rec.sid : ''
      const branches = allBranches
      //  = N→N ; =  Session  1→N .
      const continueBranches = !nearMode && (st.zoomScope === 'run' || inferredFleet) ? branches : []
      const continueCurrentGroup = continueBranches.length >= 2
      const zoomView = st.zoomView
      const targetBranchCount = Math.max(2, Math.min(4, st.zoomLanes.length || 2))
      let nearFlow = null
      if (nearMode && selectedCard) {
        const nearLog = await readLog(selectedCard.rec.sid)
        const nearLive = live && live.sessionId === selectedCard.rec.sid ? live : null
        const items = parseItems((nearLog && nearLog.events) || [], nearLive)
        const nodes = buildNodes(items)
        const limit = Number.isFinite(Number(st.limit)) ? Math.max(60, Math.floor(Number(st.limit) / 60) * 60) : 60
        st.limit = limit
        const shown = nodes.slice(-limit)
        nearFlow = { items, nodes, shown, hasOlder: nodes.length > shown.length }
      }
      const zoomMotion = st.zoomMotion === 'focus' || st.zoomMotion === 'overview' ? st.zoomMotion : ''
      delete st.zoomMotion
      const currentConversationItems = activeRun && activeRound ? activeRound.sids.map((runSid, i) =>
        '<span class="fl-zoom-current-item"><button type="button" class="fl-zoom-current-session' + (runSid === st.zoomFocusSid ? ' is-active' : '') + '" data-action="fzoom-open" data-run="' + esc(activeRun.id) + '" data-sid="' + esc(runSid) + '" title="Session ' + (i + 1) + '">' +
          '<span>Session ' + (i + 1) + '</span><span>' + esc(activeRound.routes[i] || '') + '</span><code>' + esc(runSid.replace(/^session-/, '').slice(0, 8)) + '</code>' +
        '</button><button type="button" class="fl-zoom-current-remove" data-action="fzoom-run-remove" data-sid="' + esc(runSid) + '" title="Remove session">×</button></span>').join('') : ''
      const addSessionMenu = activeRound && activeRound.sids.length < 4
        ? '<button type="button" class="fl-zoom-add-picker" data-zoom-add-picker="1">＋  Session</button>'
        : ''
      const headOf = (c, isRoot) => {
        const rec = c.rec
        const sum = c.sum
        const short = rec.sid.replace(/^session-/, '').slice(0, 8)
        const title = sum && sum.title ? sum.title : 'Session ' + short
        const badges = []
        if (isRoot) badges.push('<span class="fl-zoom-badge fl-zoom-badge-home">' + (rec.sid === home ? 'Home' : 'Root') + '</span>')
        if (rec.fleet) badges.push('<span class="fl-zoom-badge fl-zoom-badge-fleet">⚡ Fleet</span>')
        if (sum && sum.route) badges.push('<span class="fl-zoom-badge fl-zoom-badge-model" title="Model route">' + esc(sum.route) + '</span>')
        if (rec.header && rec.header.origin === 'subagent') badges.push('<span class="fl-zoom-badge"> L' + Math.max(1, rec.depth || 1) + '</span>')
        if (st.zoomScope === 'run' && rec.header && rec.header.cwd) {
          const cwdShort = String(rec.header.cwd).replace(/[\\/]+$/, '').split(/[\\/]/).pop()
          if (cwdShort) badges.push('<span class="fl-zoom-badge fl-zoom-badge-cwd" title="' + esc(rec.header.cwd) + '">' + esc(cwdShort) + '</span>')
        }
        const dotCls = c.running ? ' fl-zoom-dot-running' : c.live ? ' fl-zoom-dot-online' : ''
        const statusTxt = c.running ? 'Running' : c.live ? 'Online' : 'Offline'
        const stats = sum
          ? sum.nodes + ' nodes · ' + sum.tools + ' tools' + (sum.toolErr ? ' · ' + sum.toolErr + ' errors' : '') + (sum.tok ? ' · +' + sum.tok + ' tok' : '') + (sum.lastTime ? ' · ' + fmtTime(sum.lastTime) : '')
          : 'No activity'
        return '<div class="fl-zoom-head">' +
            '<span class="fl-zoom-dot' + dotCls + '" title="' + statusTxt + '"></span>' +
            '<span class="fl-zoom-title">' + esc(oneLine(title, 42)) + '</span>' +
            '<span class="fl-zoom-id">' + esc(short) + '</span>' +
            '<button type="button" class="fl-zoom-relay" data-action="fzoom-relay" data-sid="' + esc(rec.sid) + '" title="Relay from this session">⇪</button>' +
          '</div>' +
          (badges.length ? '<div class="fl-zoom-badges">' + badges.join('') + '</div>' : '') +
          '<div class="fl-zoom-stats">' + esc(stats) + '</div>'
      }
      const openTip = st.follow ? 'Inspect this session in Flowglass and switch Harness active session' : 'Inspect this session in Flowglass'
      const zoomHelp = [
        '• Flow Zoom is a container for concurrent tasks: inspect all branches side by side in Panorama, or fill the canvas with full flow in Inspect mode.',
        '• Default view is chosen automatically: multi-branch sessions default to Panorama; single sessions default to Inspect.',
        '• Panorama supports Compact, Detail, and Mind Map views. Click any branch card to inspect it.',
        '• Mind Map plots the full branch tree: vertical edge = reused session, diagonal edge = branched session.',
        '• Panorama sending continues N→N across the group; Inspect sending forks 1→N from current session.',
        '• Inspect workbench can toggle "Reuse current session" to continue branch 1 in-place.',
        '• "Flow Zoom History" preserves execution topology across rounds without overwriting older history.',
        '• Branch card ⇪ passes latest assistant conclusion into other sessions (as draft or sent immediately).',
        '• Presentation rules are shared with standard Flowglass.',
      ].join('\n')
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root tb-pane' + (zoomMotion ? ' fl-zoom-motion-' + zoomMotion : '') + '" data-flow' + (!nearMode ? ' data-flow-board="1"' : '') + ' data-flow-view="' + esc(zoomView) + '" data-flow-scope="' + esc(sid) + '" data-zoom-active-sids="' + esc(continueBranches.map((c) => c.rec.sid).join(',')) + '" data-zoom-run-id="' + esc(activeRun ? activeRun.id : '') + '" data-zoom-round-id="' + esc(activeRound ? activeRound.id : '') + '" data-flow-has-older="' + (nearFlow && nearFlow.hasOlder ? '1' : '0') + '" data-flow-visible="' + (nearFlow ? nearFlow.shown.length : shownCards.length) + '" data-flow-total="' + (nearFlow ? nearFlow.nodes.length : total) + '" data-autorefresh="' + flowAutorefreshOf(st) + '" data-tab-badge="' + (st.live && runningCount ? String(runningCount) + ' live' : '') + '">')
      parts.push('<div class="tb-pane-head">')
      parts.push('<div class="tb-row">' +
        '<span class="tb-sec-label">' + tHost(st, 'flowZoomTitle') + '</span>' +
        '<span class="fl-zoom-count" aria-label="' + 'Flow Zoom scale' + '">' +
          '<button type="button" class="tb-chip' + (!nearMode ? ' tb-chip-on' : '') + '" data-action="fzoom-focus-back" title="' + tHost(st, 'zoomPanoramaTip') + '">' + tHost(st, 'zoomPanorama') + '</button>' +
          '<button type="button" class="tb-chip' + (nearMode ? ' tb-chip-on' : '') + '" data-action="fzoom-focus-current" title="' + tHost(st, 'zoomNearTip') + '"' + (!selectedCard ? ' disabled' : '') + '>' + tHost(st, 'zoomNear') + '</button>' +
        '</span>' +
        '<span class="tb-note">' + tHost(st, 'zoomSessionsRunning', total, runningCount) + '</span>' +
        '<button type="button" class="tb-chip' + (st.zoomComposerOpen ? ' tb-chip-on' : '') + '" data-action="fzoom-composer" aria-expanded="' + (st.zoomComposerOpen ? 'true' : 'false') + '">' + (st.zoomComposerOpen ? '▾' : '▸') + tHost(st, 'sendMessage') + (continueCurrentGroup ? ' · ' + 'current ' + continueBranches.length + ' sessions' : nearMode && selectedCard ? ' · 1→' + targetBranchCount : '') + '</button>' +
        '<button type="button" class="tb-chip' + (st.live ? ' tb-chip-on' : '') + '" data-action="toggle-live">' + (st.live ? tHost(st, 'liveSyncing') : tHost(st, 'paused')) + '</button>' +
        '<button type="button" class="tb-chip' + (st.follow ? ' tb-chip-on' : '') + '" data-action="toggle-follow" title="' + 'When enabled, selecting a session in Flow Zoom switches the main Harness session' + '">' + (st.follow ? tHost(st, 'subagentFollowOn') : tHost(st, 'subagentFollowOff')) + '</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">' + tHost(st, 'refresh') + '</button>' +
        '<span class="fl-info" tabindex="0" aria-label="' + tHost(st, 'zoomGuideAria') + '">' +
          '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4"/><circle cx="8" cy="4.7" r=".7" fill="currentColor" stroke="none"/></svg>' +
          '<span class="fl-info-pop">' + esc(zoomHelp) + '</span>' +
        '</span>' +
      '</div>')
      // (, Host RPC:/ Client ):
      //  ⚡  —— ,;
      // . Client ;
      // data-action-onchange  state().
      if (st.zoomComposerOpen) {
        const routes = await buildZoomRoutes()
        const routeOptions = (sel) => '<option value="">' + tHost(st, 'defaultFollowCurrent') + '</option>' + routes.map((r) => '<option value="' + esc(r.value) + '"' + (r.value === sel ? ' selected' : '') + '>' + esc(r.label) + '</option>').join('')
        const effortOptions = (route, sel) => {
          const meta = routes.find((r) => r.value === route)
          if (!meta || !meta.efforts.length) return '<option value="">' + tHost(st, 'thinkingFollowModel') + '</option>'
          const inherited = meta.defaultEffort ? 'Default (' + meta.defaultEffort + ')' : 'Default'
          return '<option value="">Thinking: ' + esc(inherited) + '</option>' + meta.efforts.map((e) => '<option value="' + esc(e.id) + '"' + (e.id === sel ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('')
        }
        const laneSelects = st.zoomLanes.map((lane, i) =>
          '<span class="fl-zoom-lane-group" title="Branch ' + (i + 1) + ': model and reasoning effort">' +
            '<select class="tb-select fl-zoom-lane fl-zoom-lane-model" data-field="zoomLane.' + i + '" data-action-onchange="fzoom-lane" data-lane="' + i + '" data-zoom-lane="1">' + routeOptions(lane) + '</select>' +
            '<select class="tb-select fl-zoom-lane fl-zoom-lane-effort" data-field="zoomEffort.' + i + '" data-action-onchange="fzoom-effort" data-lane="' + i + '" data-zoom-effort="1"' + (!lane ? ' disabled' : '') + '>' + effortOptions(lane, st.zoomEfforts[i] || '') + '</select>' +
          '</span>'
        ).join('')
        //  1→N "": 1 , N−1 .
        // Client  chip  aria-pressed(data-zoom-reuse); fzoom-reuse  state,.
        const zoomReuseOn = nearMode && selectedCard && st.zoomReuse === true
        const reuseChip = nearMode && selectedCard
          ? '<button type="button" class="tb-chip' + (zoomReuseOn ? ' tb-chip-on' : '') + '" data-action="fzoom-reuse" data-zoom-reuse="1" aria-pressed="' + (zoomReuseOn ? 'true' : 'false') + '" title="When enabled: current session continues as branch 1, creating only ' + (targetBranchCount - 1) + ' new branches">' + tHost(st, 'reuseCurrentSession') + '</button>'
          : ''
        const zoomComposerContext = continueCurrentGroup && activeRun && activeRound
          ? '<div class="fl-zoom-composer-context"><strong>Send to current ' + activeRound.sids.length + ' sessions</strong><span>' + esc(oneLine(activeRun.prompt || 'Concurrent Task', 28)) + ' · ' + esc(zoomTopology(activeRun)) + '</span><div class="fl-zoom-composer-targets" data-zoom-add-drop="1">' + currentConversationItems + addSessionMenu + '</div></div>'
          : nearMode && selectedCard
            ? '<div class="fl-zoom-composer-context"><strong>' + (zoomReuseOn ? 'Reuse current session and create ' + (targetBranchCount - 1) + ' branches (1→' + targetBranchCount + ')' : 'Fork 1→' + targetBranchCount + ' from current session') + '</strong><span>Source Session: ' + esc(selectedCard.rec.sid.replace(/^session-/, '').slice(0, 8)) + '</span></div>'
            : '<div class="fl-zoom-composer-context"><strong>New concurrent sessions</strong><span>Input once, create and dispatch to ' + targetBranchCount + ' sessions</span></div>'
        const zoomPromptPlaceholder = continueCurrentGroup ? 'This message will be sent to the sessions listed above' : nearMode && selectedCard ? (zoomReuseOn ? 'This message will continue the current session and branch ' + (targetBranchCount - 1) + ' new sessions' : 'This message will fork new branches from current session') : 'Enter task to create new concurrent sessions'
        const zoomLaunchLabel = continueCurrentGroup ? 'Send to current ' + continueBranches.length + ' sessions' : nearMode && selectedCard ? (zoomReuseOn ? 'Reuse session + ' + (targetBranchCount - 1) + ' branches' : 'Fork 1→' + targetBranchCount + ' from current') : 'Create ' + st.zoomLanes.length + ' sessions and send'
        parts.push('<div class="fl-zoom-composer">' +
          zoomComposerContext +
          '<textarea class="tb-input fl-zoom-prompt" data-zoom-prompt="1" rows="2" placeholder="' + zoomPromptPlaceholder + '"></textarea>' +
          '<div class="fl-zoom-composer-controls">' + laneSelects + reuseChip +
            '<span class="fl-zoom-target-label">' + tHost(st, 'targetBranchCount') + '</span>' +
            '<span class="fl-zoom-count" title="' + 'Number of target branches' + '">' + [2, 3, 4].map((n) => '<button type="button" class="tb-chip' + (st.zoomLanes.length === n ? ' tb-chip-on' : '') + '" data-action="fzoom-lanes" data-count="' + n + '">' + n + '</button>').join('') + '</span>' +
            '<span class="fl-zoom-composer-spacer"></span>' +
            '<button type="button" class="tb-btn tb-btn-sm tb-btn-primary" data-zoom-launch="1">⚡ ' + zoomLaunchLabel + '</button>' +
          '</div></div>')
      }
      // ;, Session .
      parts.push('<div class="tb-row fl-zoom-logbar"><span class="tb-note fl-zoom-log-spacer"></span>' +
        '<span class="tb-sec-label">View</span>' +
        (nearMode ? '<span class="tb-note">Full Flow · ' + esc(selectedCard ? oneLine((selectedCard.sum && selectedCard.sum.title) || selectedCard.rec.sid, 24) : 'No branch selected') + '</span>' :
          '<button type="button" class="tb-chip' + (st.zoomView === 'compact' ? ' tb-chip-on' : '') + '" data-action="fzoom-view" data-view="compact">' + tHost(st, 'compactView') + '</button>' +
          '<button type="button" class="tb-chip' + (st.zoomView === 'detail' ? ' tb-chip-on' : '') + '" data-action="fzoom-view" data-view="detail">' + tHost(st, 'detailView') + '</button>' +
          '<button type="button" class="tb-chip' + (st.zoomView === 'map' ? ' tb-chip-on' : '') + '" data-action="fzoom-view" data-view="map">' + tHost(st, 'mapView') + '</button>') +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="fzoom-history">' + tHost(st, 'flowZoomHistory', st.zoomRuns.length) + '</button>' +
      '</div>')
      parts.push('</div>')
      if (st.zoomHistoryOpen) {
        parts.push('<aside class="fl-zoom-history-drawer"><div class="fl-zoom-history-drawer-head"><strong>' + tHost(st, 'flowZoomHistoryDrawerTitle') + '</strong><button type="button" data-action="fzoom-history">×</button></div><div class="fl-zoom-history-tree">' +
          st.zoomRuns.slice().reverse().map((run) => {
            const active = run.id === st.zoomRunId
            const expanded = st.zoomExpandedHistories.includes(run.id)
            const summary = oneLine(run.prompt || run.name || 'Concurrent Task', 24)
            return '<section class="fl-history-node' + (active ? ' is-active' : '') + '"><div class="fl-history-run-line">' +
              '<button type="button" class="fl-history-toggle" data-action="fzoom-history-toggle" data-run="' + esc(run.id) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '" title="' + (expanded ? 'Collapse history' : 'Expand history') + '">' + (expanded ? '▾' : '▸') + '</button>' +
              '<button type="button" class="fl-history-run" data-action="fzoom-run" data-run="' + esc(run.id) + '" title="' + esc(run.prompt || 'Concurrent Task') + '"><span>⚡ ' + esc(summary) + '</span><small>' + esc(zoomTopology(run)) + '</small></button></div>' +
              (expanded ? '<div class="fl-history-rounds">' + run.rounds.map((round, ri) => '<section class="fl-history-round-node' + (active && round.id === st.zoomRoundId ? ' is-active' : '') + '"><button type="button" class="fl-history-round" data-action="fzoom-round" data-run="' + esc(run.id) + '" data-round="' + esc(round.id) + '"><span>└ ' + (ri === 0 ? 'Initial' : 'Round ' + ri) + '</span><small>' + (round.sourceSids.length ? round.sourceSids.length + '→' : '') + round.sids.length + '</small></button>' +
                '<div class="fl-history-children">' + round.sids.map((runSid, i) => '<button type="button" class="fl-history-session" data-action="fzoom-open" data-run="' + esc(run.id) + '" data-round="' + esc(round.id) + '" data-sid="' + esc(runSid) + '"><span>└ Session ' + (i + 1) + '</span><code>' + esc(runSid.replace(/^session-/, '').slice(0, 8)) + '</code></button>').join('') + '</div></section>').join('') + '</div>' : '') + '</section>'
          }).join('') + '</div></aside>')
      }
      parts.push('<div class="tb-pane-body">')
      if (!shownCards.length) {
        parts.push('<div class="tb-notice">' + (st.zoomScope === 'run' ? tHost(st, 'noConcurrentRecords') : tHost(st, 'noDisplayableSessions')) + '</div>')
      } else if (nearFlow && selectedCard) {
        //  diff:,.
        const nearRows = await renderFlowNodeRows(nearFlow.shown, st, null)
        if (nearFlow.hasOlder) nearRows.push('<div class="tb-notice fl-older" data-flow-older-hint>Showing latest ' + nearFlow.shown.length + ' nodes · Scroll up to load ' + Math.min(60, nearFlow.nodes.length - nearFlow.shown.length) + ' earlier nodes</div>')
        //  rows.reverse()  tb-pane-body , column-reverse .
        //  wrapper, reverse,“,”.
        parts.push('<div class="fl-zoom-near-flow" data-flow-near-session="' + esc(selectedCard.rec.sid) + '">' + (nearRows.length ? nearRows.join('') : '<div class="tb-notice">' + tHost(st, 'flowNoEvents') + '</div>') + '</div>')
      } else {
        if ((st.zoomScope === 'run' || inferredFleet || zoomView === 'detail') && branches.length) {
          // / Git diff ;,.
          const comparison = await buildZoomTurnCompare(branches)
          const widths = zoomView === 'detail'
            ? branches.map((c) => (c.sum && c.sum.hasSubagent) ? 'minmax(620px,680px)' : 'minmax(420px,480px)')
            : branches.map(() => 'minmax(220px,280px)')
          if (zoomView === 'map') {
            const nodeW = 244
            const nodeH = 126
            const colGap = 94
            const rowGap = 54
            const rootW = 190
            const rootY = 24
            const firstRowY = 156
            const nodePos = new Map()
            const nodeHtml = []
            const turnHtml = []
            const edges = []
            let canvasW = 760
            let canvasH = 520
            // (run ):(),
            // ;—— = , = .
            // ,(/).
            const runRounds = st.zoomScope === 'run' && activeRun && Array.isArray(activeRun.rounds) ? activeRun.rounds : []
            if (runRounds.length) {
              const MAP_CAP_ROUNDS = 8
              const MAP_CAP_LANES = 8
              const workRounds = runRounds.filter((r) => r && r.kind !== 'initial').slice(-MAP_CAP_ROUNDS)
              const laneOrder = [] // :;
              const laneTurn = new Map() // sid →  turn()
              const latestNode = new Map() // sid →  id
              const titleIndex = new Map((Array.isArray(st.__zoomSessionIndex) ? st.__zoomSessionIndex : []).map((x) => [x.id, x.title]))
              const mapCards = []
              for (const round of workRounds) for (const s of round.sids) if (!mapCards.some((c) => c.rec.sid === s)) mapCards.push({ rec: { sid: s } })
              const mapCompare = await buildZoomTurnCompare(mapCards)
              // :(laneOrder) turn—— =  turn+1; =  turn+1
              const nodeRows = []
              workRounds.forEach((round, rowIdx) => {
                const ri = runRounds.indexOf(round) // ()," N "
                const sources = round.sourceSids.length ? round.sourceSids : (ri > 0 ? runRounds[ri - 1].sids : [])
                const inserted = new Map()
                const rowNodes = []
                round.sids.forEach((sid, i) => {
                  const src = sources.includes(sid) ? sid : (sources.length ? sources[Math.min(i, sources.length - 1)] : null)
                  if (!laneOrder.includes(sid)) {
                    if (laneOrder.length >= MAP_CAP_LANES) return
                    if (src && laneOrder.includes(src)) {
                      const at = laneOrder.indexOf(src) + 1 + (inserted.get(src) || 0)
                      laneOrder.splice(at, 0, sid)
                      inserted.set(src, (inserted.get(src) || 0) + 1)
                    } else laneOrder.push(sid)
                  }
                  const turn = (laneTurn.has(sid) ? laneTurn.get(sid) : (src && laneTurn.has(src) ? laneTurn.get(src) : 0)) + 1
                  laneTurn.set(sid, turn)
                  rowNodes.push({ sid, round, ri, rowIdx, src, turn })
                })
                nodeRows.push(rowNodes)
              })
              const treeLaneWidth = laneOrder.length * nodeW + Math.max(0, laneOrder.length - 1) * colGap
              canvasW = Math.max(760, treeLaneWidth + 220)
              const laneStartX = Math.round((canvasW - treeLaneWidth) / 2)
              const rootX = Math.round((canvasW - rootW) / 2)
              canvasH = Math.max(520, firstRowY + nodeRows.length * nodeH + Math.max(0, nodeRows.length - 1) * rowGap + 44)
              nodePos.set('root', { x: rootX, y: rootY, w: rootW, h: 84 })
              nodeHtml.push('<article class="fl-map-node fl-map-root" data-map-node="root" data-map-default-x="' + rootX + '" data-map-default-y="' + rootY + '" style="left:' + rootX + 'px;top:' + rootY + 'px;width:' + rootW + 'px"><strong>⚡ ' + esc(oneLine((activeRun && activeRun.prompt) || '', 28)) + '</strong><span>' + esc(zoomTopology(activeRun)) + ' · ' + laneOrder.length + ' </span></article>')
              nodeRows.forEach((rowNodes2, rowIdx) => {
                if (!rowNodes2.length) return
                const ri = rowNodes2[0].ri
                const rowY = firstRowY + rowIdx * (nodeH + rowGap)
                turnHtml.push('<div class="fl-map-turn-label" style="left:' + Math.max(12, laneStartX - 86) + 'px;top:' + (rowY + Math.round(nodeH / 2) - 15) + 'px"><span>' + ri + '</span><strong> ' + ri + ' </strong></div>')
                // ,:""(),
                //  latestNode——.
                for (const n of rowNodes2) {
                  const lane = laneOrder.indexOf(n.sid)
                  const nodeId = 'r' + n.ri + '-' + n.sid
                  n.nodeId = nodeId
                  n.from = n.src && latestNode.has(n.src) ? latestNode.get(n.src) : 'root'
                  const x = laneStartX + lane * (nodeW + colGap)
                  const y = rowY
                  nodePos.set(nodeId, { x, y, w: nodeW, h: nodeH })
                  const grouped = mapCompare.perSession.get(n.sid)
                  const value = grouped ? grouped.get(n.turn) : null
                  const lastAi = value ? value.items.filter((it) => it.kind === 'msg' && it.role === 'ai' && !it.streaming).slice(-1)[0] : null
                  const branchSeq = lastAi ? (lastAi.finalSeq != null ? lastAi.finalSeq : lastAi.seq) : null
                  const result = oneLine((value && value.result) || '(no content)', 92)
                  const card = bySid.get(n.sid)
                  const title = titleIndex.get(n.sid) || (card && card.sum && card.sum.title) || ''
                  const label = title ? oneLine(title, 16) : ' ' + (lane + 1)
                  nodeHtml.push('<article class="fl-map-node" data-map-node="' + nodeId + '" data-map-default-x="' + x + '" data-map-default-y="' + y + '" data-flow-detail-session="' + esc(n.sid) + '" style="left:' + x + 'px;top:' + y + 'px;width:' + nodeW + 'px">' +
                    '<header><strong>' + esc(label) + '</strong><span> ' + n.ri + ' </span></header>' +
                    '<p>' + esc(result) + '</p>' +
                    (branchSeq == null ? '' : '<button type="button" class="fl-map-branch" data-flow-branch data-history="' + esc(activeRun.id) + '" data-round="' + esc(n.round.id) + '" data-turn="' + n.ri + '" data-seq="' + branchSeq + '" title=" ' + esc(label) + '  ' + n.ri + ' , ' + targetBranchCount + '  Session"> 1→' + targetBranchCount + '</button>') +
                  '</article>')
                }
                for (const n of rowNodes2) {
                  if (!edges.some((e) => e.from === n.from && e.to === n.nodeId)) edges.push({ from: n.from, to: n.nodeId })
                  latestNode.set(n.sid, n.nodeId)
                }
              })
            } else {
            // (/): ×
            const rows = comparison.rows
            const laneWidth = branches.length * nodeW + Math.max(0, branches.length - 1) * colGap
            canvasW = Math.max(760, laneWidth + 220)
            const laneStartX = Math.round((canvasW - laneWidth) / 2)
            const rootX = Math.round((canvasW - rootW) / 2)
            canvasH = Math.max(520, firstRowY + rows.length * nodeH + Math.max(0, rows.length - 1) * rowGap + 44)
            nodePos.set('root', { x: rootX, y: rootY, w: rootW, h: 84 })
            nodeHtml.push('<article class="fl-map-node fl-map-root" data-map-node="root" data-map-default-x="' + rootX + '" data-map-default-y="' + rootY + '" style="left:' + rootX + 'px;top:' + rootY + 'px;width:' + rootW + 'px"><strong>⚡ ' + esc(oneLine((activeRun && activeRun.prompt) || '', 28)) + '</strong><span>' + esc(zoomTopology(activeRun)) + ' · ' + branches.length + ' </span></article>')
            for (let r = 0; r < rows.length; r++) {
              const row = rows[r]
              const displayTurn = row.turn === 0 ? 1 : row.turn
              const rowY = firstRowY + r * (nodeH + rowGap)
              turnHtml.push('<div class="fl-map-turn-label" style="left:' + Math.max(12, laneStartX - 86) + 'px;top:' + (rowY + Math.round(nodeH / 2) - 15) + 'px"><span>' + displayTurn + '</span><strong> ' + displayTurn + ' </strong></div>')
              for (let i = 0; i < branches.length; i++) {
                const value = row.values[i]
                if (!value) continue
                const nodeId = 't' + row.turn + '-s' + i
                const x = laneStartX + i * (nodeW + colGap)
                const y = rowY
                nodePos.set(nodeId, { x, y, w: nodeW, h: nodeH })
                const previous = r > 0 ? 't' + rows[r - 1].turn + '-s' + i : 'root'
                if (nodePos.has(previous)) edges.push({ from: previous, to: nodeId })
                const lastAi = value.items.filter((it) => it.kind === 'msg' && it.role === 'ai' && !it.streaming).slice(-1)[0]
                const branchSeq = lastAi ? (lastAi.finalSeq != null ? lastAi.finalSeq : lastAi.seq) : null
                const result = oneLine(value.result || '(no content)', 92)
                nodeHtml.push('<article class="fl-map-node" data-map-node="' + nodeId + '" data-map-default-x="' + x + '" data-map-default-y="' + y + '" data-flow-detail-session="' + esc(branches[i].rec.sid) + '" style="left:' + x + 'px;top:' + y + 'px;width:' + nodeW + 'px">' +
                  '<header><strong> ' + (i + 1) + '</strong><span> ' + displayTurn + ' </span></header>' +
                  '<p>' + esc(result) + '</p>' +
                  (branchSeq == null || !activeRun || !activeRound ? '' : '<button type="button" class="fl-map-branch" data-flow-branch data-history="' + esc(activeRun.id) + '" data-round="' + esc(activeRound.id) + '" data-turn="' + displayTurn + '" data-seq="' + branchSeq + '" title=" ' + (i + 1) + '  ' + displayTurn + ' , ' + targetBranchCount + '  Session"> 1→' + targetBranchCount + '</button>') +
                '</article>')
              }
            }
            }
            const connectorPath = (a, b, fromId, toId) => {
              const acx = a.x + a.w / 2, acy = a.y + a.h / 2
              const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2
              const dx = bcx - acx, dy = bcy - acy
              const vertical = b.y >= a.y + a.h + 12 || a.y >= b.y + b.h + 12
              const x1 = vertical ? acx : (dx >= 0 ? a.x + a.w : a.x)
              const y1 = vertical ? (dy >= 0 ? a.y + a.h : a.y) : acy
              const x2 = vertical ? bcx : (dx >= 0 ? b.x : b.x + b.w)
              const y2 = vertical ? (dy >= 0 ? b.y : b.y + b.h) : bcy
              let blocked = false
              for (const [id, rect] of nodePos) {
                if (id === fromId || id === toId) continue
                const left = rect.x - 8, right = rect.x + rect.w + 8, top = rect.y - 8, bottom = rect.y + rect.h + 8
                for (let step = 1; step < 24; step++) {
                  const t = step / 24
                  const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t
                  if (px >= left && px <= right && py >= top && py <= bottom) { blocked = true; break }
                }
                if (blocked) break
              }
              if (!blocked) return 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2
              if (!vertical) {
                const mid = (x1 + x2) / 2
                return 'M ' + x1 + ' ' + y1 + ' H ' + mid + ' V ' + y2 + ' H ' + x2
              }
              const mid = (y1 + y2) / 2
              return 'M ' + x1 + ' ' + y1 + ' V ' + mid + ' H ' + x2 + ' V ' + y2
            }
            const lineHtml = edges.map((edge) => {
              const a = nodePos.get(edge.from), b = nodePos.get(edge.to)
              return '<path data-map-from="' + edge.from + '" data-map-to="' + edge.to + '" d="' + connectorPath(a, b, edge.from, edge.to) + '" />'
            }).join('')
            parts.push('<div class="fl-mindmap-wrap"><div class="fl-mindmap-help"><strong>Mind Map</strong><span>Drag nodes · scroll to zoom · branch 1→' + targetBranchCount + '</span><button type="button" data-map-reset="1">Reset</button></div>' +
              '<div class="fl-mindmap-viewport" data-flow-mindmap="1" data-map-scope="' + esc((activeRun && activeRun.id) || 'current') + '"><div class="fl-mindmap-canvas" style="width:' + canvasW + 'px;height:' + canvasH + 'px"><svg class="fl-mindmap-edges" width="' + canvasW + '" height="' + canvasH + '">' + lineHtml + '</svg>' + turnHtml.join('') + nodeHtml.join('') + '</div></div></div>')
          } else {
          parts.push('<div class="fl-zoom-diff-scroll"><div class="fl-zoom-diff-board" style="grid-template-columns:92px ' + widths.join(' ') + '">')
          parts.push('<div class="fl-diff-corner"></div>')
          for (const c of branches) {
            const branchIndex = branches.indexOf(c) + 1
            parts.push('<div class="fl-diff-session-head" data-action="fzoom-open" data-sid="' + esc(c.rec.sid) + '" role="button" tabindex="0" title="' + openTip + '"><div class="fl-diff-session-label"> ' + branchIndex + '</div>' + headOf(c, false) + '</div>')
          }
          for (const row of comparison.rows) {
            const displayTurn = row.turn === 0 ? 1 : row.turn
            const label = row.same ? 'Same' : row.values.some((v) => !v) ? 'Missing' : 'Changed'
            const gutterCls = row.same ? ' fl-diff-same' : row.values.some((v) => !v) ? ' fl-diff-missing' : ' fl-diff-change'
            const dim = (name, value) => '<span class="fl-diff-dim fl-diff-dim-' + (value === 'same' ? 'same' : value === 'changed' ? 'change' : 'missing') + '">' + name + ' ' + value + '</span>'
            const roundFork = []
            for (let i = 0; i < branches.length; i++) {
              const value = row.values[i]
              const lastAi = value && value.items.filter((it) => it.kind === 'msg' && it.role === 'ai' && !it.streaming).slice(-1)[0]
              if (lastAi) roundFork.push({ sid: branches[i].rec.sid, seq: lastAi.finalSeq != null ? lastAi.finalSeq : lastAi.seq })
            }
            parts.push('<div class="fl-diff-gutter' + gutterCls + '"><strong> ' + displayTurn + ' </strong><span>' + label + '</span>' +
              '<small>' + dim('Input', row.dims.input) + dim('Tools', row.dims.flow) + dim('Files', row.dims.files) + dim('Result', row.dims.result) + '</small>' +
              (roundFork.length < 2 || !activeRun || !activeRound ? '' : '<button type="button" class="fl-diff-round-fork" data-zoom-round-fork="1" data-history="' + esc(activeRun.id) + '" data-round="' + esc(activeRound.id) + '" data-turn="' + displayTurn + '" data-spec="' + esc(JSON.stringify(roundFork)) + '" title=" ' + roundFork.length + ' , ' + targetBranchCount + '  Session">:' + roundFork.length + '→' + targetBranchCount + '</button>') +
              '</div>')
            const baseline = row.values.find((v) => v) || null
            const baselineSig = baseline ? baseline.input + '\n' + baseline.tools + '\n' + baseline.files : ''
            for (let i = 0; i < branches.length; i++) {
              const c = branches[i]
              const value = row.values[i]
              if (!value) {
                parts.push('<div class="fl-diff-cell fl-diff-cell-missing"><span>− </span></div>')
                continue
              }
              const sig = value.input + '\n' + value.tools + '\n' + value.files
              const changed = !row.same && sig !== baselineSig
              const hasSubagent = value.items.some((it) => it.kind === 'call' && it.cat === 'subagent')
              const lastAi = value.items.filter((it) => it.kind === 'msg' && it.role === 'ai' && !it.streaming).slice(-1)[0]
              const branchSeq = lastAi ? (lastAi.finalSeq != null ? lastAi.finalSeq : lastAi.seq) : null
              let flowHtml
              if (zoomView === 'detail') {
                const detailState = { ...st, zoom: false, sid: c.rec.sid, home: c.rec.sid, crumbs: [], settings: false, expanded: null }
                const nodeRows = await renderFlowNodeRows(buildNodes(value.items), detailState, null)
                flowHtml = '<div class="fl-turn-cell-flow ' + (hasSubagent ? 'fl-flow-three' : 'fl-flow-two') + '">' + nodeRows.join('') + '</div>'
              } else {
                const user = value.items.filter((it) => it.kind === 'msg' && it.role === 'user').slice(-1)[0]
                const aiLast = value.items.filter((it) => it.kind === 'msg' && it.role === 'ai').slice(-1)[0]
                const tools = value.items.filter((it) => it.kind === 'call').map((it) => it.name)
                flowHtml = '<div class="fl-compact-diff">' +
                  (user ? '<div><b>▲</b><span>' + esc(oneLine(user.preview || user.full || '', 72)) + '</span></div>' : '') +
                  (tools.length ? '<div><b>◇</b><span>' + esc([...new Set(tools)].join(' → ')) + '</span></div>' : '<div><b>◇</b><span></span></div>') +
                  (aiLast ? '<div><b>◆</b><span>' + esc(oneLine(aiLast.preview || aiLast.full || '', 82)) + '</span></div>' : '') +
                '</div>'
              }
              parts.push('<div class="fl-diff-cell' + (row.same ? ' fl-diff-cell-same' : changed ? ' fl-diff-cell-change' : ' fl-diff-cell-base') + '" data-flow-detail-session="' + esc(c.rec.sid) + '">' +
                '<div class="fl-diff-cell-head"><span class="fl-diff-mark">' + (row.same ? ' ' : changed ? '+' : '±') + '</span>' +
                  '<span>' + (row.same ? 'Same' : changed ? 'Changed' : 'Baseline') + '</span>' +
                  (branchSeq == null || !activeRun || !activeRound ? '' : '<button type="button" class="fl-diff-branch" data-flow-branch data-history="' + esc(activeRun.id) + '" data-round="' + esc(activeRound.id) + '" data-turn="' + displayTurn + '" data-seq="' + branchSeq + '" title=" ' + (i + 1) + '  ' + displayTurn + ' , ' + targetBranchCount + '  Session"> ' + (i + 1) + ': ' + displayTurn + '  1→' + targetBranchCount + '</button>') +
                '</div>' + flowHtml + '</div>')
            }
          }
          parts.push('</div></div>')
          }
        } else {
        parts.push('<div class="fl-zoom-tree">')
        // :tree=(/);live=(,)
        if (rootC) {
          parts.push('<div class="fl-zoom-card fl-zoom-rootcard' + (rootC.running ? ' fl-live' : '') + '" data-action="fzoom-open" data-sid="' + esc(rootC.rec.sid) + '" role="button" tabindex="0" title="' + openTip + '">' + headOf(rootC, true) + '</div>')
        } else {
          parts.push('<div class="fl-zoom-rootcard fl-zoom-rootcard-virtual"><span class="fl-zoom-title">⚡ ' + esc(activeRun && activeRun.prompt ? oneLine(activeRun.prompt, 54) : inferredFleetPrompt ? oneLine(inferredFleetPrompt, 54) : '') + ' · ' + total + ' </span></div>')
        }
        if (!branches.length) {
          parts.push('<div class="tb-notice">No concurrent sessions found.</div>')
        } else {
          parts.push('<div class="fl-zoom-trunk"></div>')
          parts.push('<div class="fl-zoom-branches">' + branches.map((c) => {
            const flowHtml = c.sum && c.sum.strip.length
              ? zoomFlowHtml(c.sum)
              : '<div class="fl-zoom-flow"><div class="fl-zoom-step"><span class="fl-zoom-more">No activity</span></div></div>'
            return '<div class="fl-zoom-branch" data-action="fzoom-open" data-sid="' + esc(c.rec.sid) + '" role="button" tabindex="0" title="' + openTip + '">' +
              '<div class="fl-zoom-card fl-zoom-branch-head' + (c.running ? ' fl-live' : '') + '">' + headOf(c, false) + '</div>' +
              flowHtml +
            '</div>'
          }).join('') + '</div>')
          if (total > shownCards.length) parts.push('<div class="tb-notice">Showing ' + shownCards.length + ' of ' + total + ' sessions</div>')
        }
        parts.push('</div>')
        }
      }
      parts.push('</div>')
      if (nearFlow && st.expanded != null) {
        const target = nearFlow.items.find((it) => it.seq === st.expanded && (it.kind === 'call' || it.kind === 'msg'))
        if (target) parts.push(target.kind === 'call' ? detailRail(target, st.freshSeq === target.seq, st.presentationRules) : msgRail(target, st.freshSeq === target.seq))
      }
      delete st.freshSeq
      delete st.freshSettings
      parts.push('</div>')
      return parts.join('')
    }

    const render = async (st, sid, live) => {
      if (st.zoom) return renderZoom(st, sid, live)
      const r = await readLog(sid)
      // : = (;/)
      const prevCount = growth[sid]
      const active = prevCount != null && (r.count || 0) > prevCount
      growth[sid] = r.count || 0
      await loadManifestTools()
      //  attempt(live )=
      const overlayLive = Boolean(live && Array.isArray(live.attempts) && live.attempts.some((a) => a && a.attemptId != null))
      const items = parseItems(r.events || [], live)
      const nodes = buildNodes(items)
      //  → ; sessions .
      const lastIt = items.length ? items[items.length - 1] : null
      let sessionLive = false
      let hasAgentStatus = false
      try {
        const agentsSvc = ctx.get('agents')
        if (agentsSvc) {
          hasAgentStatus = true
          const agent = agentsSvc.get(sid)
          sessionLive = !!(agent && agent.status === 'running')
        }
      } catch (e) {}
      // provider/ agent  idle,step/end / turn/end .
      // agent :,“”.
      // : attempt(live )——,
      //  agent idle (/agents ).
      if (hasAgentStatus && !sessionLive && !overlayLive) {
        const tail = r.events && r.events.length ? r.events[r.events.length - 1] : null
        const settledAt = tail && Number.isFinite(Number(tail.time)) ? Number(tail.time) : null
        for (const it of items) {
          if (it.kind !== 'msg' || it.role !== 'ai' || !it.streaming) continue
          it.streaming = false
          it.interrupted = true
          it.runDur = Math.max(0, (settledAt != null ? settledAt : it.runStart) - it.runStart)
          it.preview = (it.full ? oneLine(it.full, 100) + ' ' : '') + '(no content)'
        }
      }
      const liveAiSeq = (overlayLive || (hasAgentStatus ? sessionLive : active)) && lastIt && lastIt.kind === 'msg' && lastIt.role === 'ai' && !lastIt.interrupted ? lastIt.seq : null
      const PAGE = 60
      const limit = Number.isFinite(Number(st.limit)) ? Math.max(PAGE, Math.floor(Number(st.limit) / PAGE) * PAGE) : PAGE
      st.limit = limit
      const shown = nodes.slice(-limit)
      const hasOlder = nodes.length > shown.length
      const parts = []
      parts.push('<div class="jr-tabpanel tb-root tb-pane" data-flow data-flow-scope="' + esc(sid) + '" data-flow-has-older="' + (hasOlder ? '1' : '0') + '" data-flow-visible="' + shown.length + '" data-flow-total="' + nodes.length + '" data-autorefresh="' + flowAutorefreshOf(st) + '" data-tab-badge="' + (st.live ? String(nodes.length) : '') + '">')
      //
      parts.push('<div class="tb-pane-head">')
      // : → "← "+ (crumbs )
      const drilled = !!((st.home && sid !== st.home) || (Array.isArray(st.crumbs) && st.crumbs.length))
      const depth = drilled && Array.isArray(st.crumbs) ? st.crumbs.length : 0
      const help = [
        '• Center column: User / Assistant spine; Right column: Tool calls (Input ▶ / Output ◀); Left column: Subagent branches.',
        '• Click any card to inspect full content and details.',
        '• Hover assistant card to fork a new session branch in Harness.',
        '• Canvas supports drag-to-box-select; click empty space to clear selection; bottom-left lets you create a draft from selection.',
        '• Zoom controls support scaling and native Zen mode.',
        '• Click a subagent card to enter its live sub-flow; "Subagent Follow" synchronizes the Harness active session.',
        '• Scroll to top to automatically load 60 earlier nodes.',
      ].join('\n')
      parts.push('<div class="tb-row">' +
        (drilled ? '<button type="button" class="tb-btn tb-btn-sm" data-action="fback" title="' + 'Back to parent flow' + '">' + tHost(st, 'back') + '</button>' : '') +
        '<span class="tb-sec-label">' + (drilled ? tHost(st, 'subFlow') : tHost(st, 'realtimeFlow')) + '</span>' +
        '<span class="tb-note">' + esc(sid.replace(/^session-/, '').slice(0, 8)) + ' · ' + tHost(st, 'eventsAndNodes', items.length, nodes.length, drilled ? depth + 1 : 0) + '</span>' +
        '<button type="button" class="tb-chip' + (st.live ? ' tb-chip-on' : '') + '" data-action="toggle-live">' + (st.live ? tHost(st, 'liveSyncing') : tHost(st, 'paused')) + '</button>' +
        '<button type="button" class="tb-chip' + (st.follow ? ' tb-chip-on' : '') + '" data-action="toggle-follow" title="' + tHost(st, 'subagentFollowTip') + '">' + (st.follow ? tHost(st, 'subagentFollowOn') : tHost(st, 'subagentFollowOff')) + '</button>' +
        '<button type="button" class="tb-btn tb-btn-sm" data-action="refresh">' + tHost(st, 'refresh') + '</button>' +
        (flowPreferencesOf(st).zoomEnabled ? '<button type="button" class="tb-btn tb-btn-sm" data-action="fzoom" title="' + tHost(st, 'flowZoomTip') + '">' + tHost(st, 'flowZoomBtn') + '</button>' : '') +
        '<span class="fl-info" tabindex="0" aria-label="' + tHost(st, 'flowGuideAria') + '">' +
          '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4"/><circle cx="8" cy="4.7" r=".7" fill="currentColor" stroke="none"/></svg>' +
          '<span class="fl-info-pop">' + esc(help) + '</span>' +
        '</span>' +
      '</div>')
      parts.push('</div>')
      // :tb-pane-body  column-reverse——"":DOM ,
      parts.push('<div class="tb-pane-body">')
      if (!shown.length) {
        parts.push('<div class="tb-notice">' + tHost(st, 'flowNoEvents') + '</div>')
      } else {
        const rows = await renderFlowNodeRows(shown, st, liveAiSeq)
        if (hasOlder) rows.push('<div class="tb-notice fl-older" data-flow-older-hint>' +
          tHost(st, 'flowOlderHint', shown.length, Math.min(PAGE, nodes.length - shown.length)) +
        '</div>')
        parts.push(rows.reverse().join(''))
      }
      parts.push('</div>')
      // :(→/;→)
      if (st.expanded != null) {
        const target = items.find((it) => it.seq === st.expanded && (it.kind === 'call' || it.kind === 'msg'))
        if (target) parts.push(target.kind === 'call' ? detailRail(target, st.freshSeq === target.seq, st.presentationRules, st) : msgRail(target, st.freshSeq === target.seq, st))
      }
      delete st.freshSeq // , state
      delete st.freshSettings
      parts.push('</div>')
      return parts.join('')
    }

    const handler = async ({ action, fields, state, session, live }) => {
      if (!sq) return { ok: false, error: 'sessionQuery ', html: '' }
      const st = (state && typeof state === 'object' && state) ? state : { live: true, follow: true, limit: 60, sid: null, home: null, expanded: null, crumbs: [] }
      const flowPreferences = normalizeFlowPreferences(fields && fields.__flowPreferences)
      try { Object.defineProperty(st, '__flowPreferences', { value: flowPreferences, configurable: true }) } catch (e) {}
      // ;.
      st.settings = false
      if (typeof st.follow !== 'boolean') st.follow = true
      if (!Number.isFinite(Number(st.limit)) || Number(st.limit) < 60) st.limit = 60
      if (typeof st.expanded !== 'number' && st.expanded != null) st.expanded = null
      if (!Array.isArray(st.crumbs)) st.crumbs = []
      if (typeof st.zoom !== 'boolean') st.zoom = false
      if (st.zoomScope !== 'tree' && st.zoomScope !== 'run') st.zoomScope = 'tree'
      if (st.zoomView !== 'compact' && st.zoomView !== 'detail' && st.zoomView !== 'map') st.zoomView = flowPreferences.defaultZoomView
      if (typeof st.zoomFocusSid !== 'string') st.zoomFocusSid = ''
      if (typeof st.zoomLastFocusSid !== 'string') st.zoomLastFocusSid = ''
      if (st.zoomMode !== 'panorama' && st.zoomMode !== 'near') st.zoomMode = st.zoomFocusSid ? 'near' : 'panorama'
      if (typeof st.zoomComposerOpen !== 'boolean') st.zoomComposerOpen = false
      // "": 1→N  1 , N−1
      if (typeof st.zoomReuse !== 'boolean') st.zoomReuse = false
      if (typeof st.zoomHistoryOpen !== 'boolean') st.zoomHistoryOpen = false
      if (!Array.isArray(st.zoomExpandedHistories)) st.zoomExpandedHistories = []
      if (!Array.isArray(st.zoomRuns)) st.zoomRuns = []
      st.zoomRuns = normalizeZoomRuns(st.zoomRuns)
      let archivedSessionIds = []
      if (fields && typeof fields.__flowArchivedSessionIds === 'string' && fields.__flowArchivedSessionIds) {
        try {
          const rawArchived = JSON.parse(fields.__flowArchivedSessionIds)
          if (Array.isArray(rawArchived)) archivedSessionIds = rawArchived.slice(0, 1000).filter((id) => typeof id === 'string' && /^[\w-]{1,100}$/.test(id))
        } catch (e) {}
      }
      const archivedSessionSet = new Set(archivedSessionIds)
      try { Object.defineProperty(st, '__archivedSessionIds', { value: archivedSessionSet, configurable: true }) } catch (e) {}
      if (archivedSessionSet.size) {
        st.zoomRuns = st.zoomRuns.map((run) => {
          const rounds = run.rounds.map((round) => {
            const keep = round.sids.map((sid, i) => ({ sid, i })).filter((item) => !archivedSessionSet.has(item.sid))
            return {
              ...round,
              sourceSids: round.sourceSids.filter((sid) => !archivedSessionSet.has(sid)),
              sids: keep.map((item) => item.sid),
              routes: keep.map((item) => round.routes[item.i] || ''),
              efforts: keep.map((item) => round.efforts[item.i] || ''),
            }
          }).filter((round) => round.sids.length)
          const latest = rounds[rounds.length - 1]
          return latest ? { ...run, rounds, sids: latest.sids, routes: latest.routes, efforts: latest.efforts } : null
        }).filter(Boolean)
      }
      // Client , state / localStorage..
      let zoomSessionIndex = []
      if (fields && typeof fields.__flowSessionIndex === 'string' && fields.__flowSessionIndex) {
        try {
          const rawIndex = JSON.parse(fields.__flowSessionIndex)
          if (Array.isArray(rawIndex)) zoomSessionIndex = rawIndex.slice(0, 200).map((x) => ({
            id: x && typeof x.id === 'string' && /^[\w-]{1,100}$/.test(x.id) ? x.id : '',
            title: x && typeof x.title === 'string' ? x.title.slice(0, 160) : '',
            cwd: x && typeof x.cwd === 'string' ? x.cwd.slice(0, 260) : '',
          })).filter((x) => x.id && x.title && !archivedSessionSet.has(x.id))
        } catch (e) {}
      }
      try { Object.defineProperty(st, '__zoomSessionIndex', { value: zoomSessionIndex, configurable: true }) } catch (e) {}
      if (typeof st.zoomRunId !== 'string') st.zoomRunId = ''
      if (typeof st.zoomRoundId !== 'string') st.zoomRoundId = ''
      // Client localStorage  Session/Tab ;,Host .
      if (fields && typeof fields.__flowZoomLog === 'string' && fields.__flowZoomLog) {
        try {
          const saved = JSON.parse(fields.__flowZoomLog)
          st.zoomRuns = normalizeZoomRuns(saved && saved.runs)
          st.zoomRunId = saved && typeof saved.activeId === 'string' ? saved.activeId : st.zoomRunId
          st.zoomRoundId = saved && typeof saved.roundId === 'string' ? saved.roundId : st.zoomRoundId
          if (saved && typeof saved.open === 'boolean') st.zoom = saved.open
          if (saved && (saved.view === 'compact' || saved.view === 'detail' || saved.view === 'map')) st.zoomView = saved.view
          if (saved && typeof saved.focusSid === 'string') st.zoomFocusSid = saved.focusSid
          if (saved && typeof saved.lastFocusSid === 'string') st.zoomLastFocusSid = saved.lastFocusSid
          if (saved && (saved.mode === 'panorama' || saved.mode === 'near')) st.zoomMode = saved.mode
        } catch (e) {}
      }
      if (!flowPreferences.zoomEnabled) {
        st.zoom = false
        st.zoomComposerOpen = false
        if (typeof action === 'string' && action.indexOf('fzoom') === 0) action = ''
      }
      if (!st.zoomRuns.some((x) => x.id === st.zoomRunId)) st.zoomRunId = st.zoomRuns.length ? st.zoomRuns[st.zoomRuns.length - 1].id : ''
      if (st.zoomScope === 'run' && session && st.zoomBoundSessionId !== session) {
        const selected = st.zoomRuns.find((x) => x.id === st.zoomRunId)
        const selectedRound = selected && (selected.rounds.find((x) => x.id === st.zoomRoundId) || selected.rounds[selected.rounds.length - 1])
        //  Harness ,; Session
        // (),.
        const internalFocusNavigation = st.zoomFocusSid === session && selectedRound
          && (selectedRound.sids.includes(session) || selectedRound.sourceSids.includes(session))
        if (!internalFocusNavigation) {
          const latest = latestZoomRunForSession(st.zoomRuns, session)
          if (latest) { st.zoomRunId = latest.run.id; st.zoomRoundId = latest.round.id }
          // Harness /,, Session;
          //  localStorage  focusSid .
          st.sid = session
          st.zoomFocusSid = session
          st.zoomLastFocusSid = session
        }
        st.zoomBoundSessionId = session
      }
      const selectedHistory = st.zoomRuns.find((x) => x.id === st.zoomRunId)
      if (selectedHistory && !selectedHistory.rounds.some((x) => x.id === st.zoomRoundId)) st.zoomRoundId = selectedHistory.rounds[selectedHistory.rounds.length - 1].id
      st.zoomExpandedHistories = st.zoomExpandedHistories.filter((id) => typeof id === 'string' && st.zoomRuns.some((run) => run.id === id))
      // ( + ;/;2–4 ,→)
      if (!Array.isArray(st.zoomLanes) || st.zoomLanes.length < 2) st.zoomLanes = Array(flowPreferences.defaultBranchCount).fill('')
      st.zoomLanes = st.zoomLanes.slice(0, 4).map((v) => (typeof v === 'string' ? v : ''))
      if (!Array.isArray(st.zoomEfforts)) st.zoomEfforts = []
      st.zoomEfforts = st.zoomLanes.map((_, i) => (typeof st.zoomEfforts[i] === 'string' ? st.zoomEfforts[i] : ''))
      if (fields && Object.prototype.hasOwnProperty.call(fields, '__flowPresentationRules')) {
        st.presentationRules = normalizePresentationRules(fields.__flowPresentationRules)
      } else if (!Array.isArray(st.presentationRules)) st.presentationRules = normalizePresentationRules(DEFAULT_PRESENTATION_RULES)
      const el = fields && fields.__el ? fields.__el : {}
      // home=();sid=(=home).
      //  Harness  session  st.sid, crumbs
      // ; home,“← ”.
      const carriedFollow = st.follow === true && st.home && session && st.sid === session
        && (st.crumbs.length > 0 || (st.zoom && st.zoomFocusSid === session))
      const home = carriedFollow ? st.home : (session || st.home || st.sid)
      if (!home) return { ok: true, html: '<div class="jr-tabpanel tb-root"><div class="tb-notice"></div></div>', state: st }
      st.home = home
      if (!st.sid) st.sid = home
      let navigateSession = null
      let flowContext = null
      let zoomRelay = null
      // live :();
      // attempts =  attempt;settled =  attempt  firstSeq(UI ).
      const liveOverlay = live && typeof live === 'object' && typeof live.sessionId === 'string' && live.sessionId === st.sid
        ? {
          sessionId: live.sessionId,
          revision: typeof live.revision === 'number' ? live.revision : 0,
          attempts: Array.isArray(live.attempts) ? live.attempts.slice(-8) : [],
          settled: Array.isArray(live.settled) ? live.settled.slice(-8) : [],
        }
        : null
      if (action === 'toggle-live') st.live = !st.live
      else if (action === 'toggle-follow') st.follow = !st.follow
      else if (action === 'fzoom') {
        st.zoom = !st.zoom
        if (st.zoom) {
          const latest = latestZoomRunForSession(st.zoomRuns, session || st.sid)
          if (latest) {
            st.zoomScope = 'run'; st.zoomRunId = latest.run.id; st.zoomRoundId = latest.round.id; st.zoomFocusSid = ''
          } else st.zoomScope = 'tree'
          st.zoomBoundSessionId = session || st.sid || ''
          //  renderZoom (→;→),.
          st.zoomAutoMode = true
        }
        st.expanded = null
        st.settings = false
      }
      else if (action === 'fzoom-scope') {
        st.zoomScope = el.scope === 'run' ? 'run' : 'tree'
        if (st.zoomScope === 'run') {
          const latest = latestZoomRunForSession(st.zoomRuns, session || st.sid)
          if (latest) { st.zoomRunId = latest.run.id; st.zoomRoundId = latest.round.id; st.zoomFocusSid = '' }
          st.zoomBoundSessionId = session || st.sid || ''
        }
      }
      else if (action === 'fzoom-view') {
        st.zoomView = el.view === 'detail' ? 'detail' : el.view === 'map' ? 'map' : 'compact'
      }
      else if (action === 'fzoom-composer') st.zoomComposerOpen = !st.zoomComposerOpen
      else if (action === 'fzoom-reuse') st.zoomReuse = !st.zoomReuse
      else if (action === 'fzoom-history') st.zoomHistoryOpen = !st.zoomHistoryOpen
      else if (action === 'fzoom-history-toggle' && typeof el.run === 'string' && st.zoomRuns.some((run) => run.id === el.run)) {
        st.zoomExpandedHistories = st.zoomExpandedHistories.includes(el.run)
          ? st.zoomExpandedHistories.filter((id) => id !== el.run)
          : [...st.zoomExpandedHistories, el.run]
      }
      else if (action === 'fzoom-focus-back') { st.zoomMode = 'panorama'; st.zoomMotion = 'overview' }
      else if (action === 'fzoom-focus-current') {
        const run = st.zoomRuns.find((x) => x.id === st.zoomRunId) || st.zoomRuns[st.zoomRuns.length - 1]
        const round = run && (run.rounds.find((x) => x.id === st.zoomRoundId) || run.rounds[run.rounds.length - 1])
        const remembered = typeof st.zoomLastFocusSid === 'string' ? st.zoomLastFocusSid : ''
        const selected = typeof st.zoomFocusSid === 'string' ? st.zoomFocusSid : ''
        const target = selected || remembered || (round && (round.sids.includes(st.sid) ? st.sid : round.sids[0])) || st.sid
        if (target) { st.zoom = true; st.zoomMode = 'near'; st.zoomFocusSid = target; st.zoomLastFocusSid = target; st.sid = target; st.expanded = null; st.zoomMotion = 'focus' }
      }
      else if (action === 'fzoom-lane') {
        // : ''();
        const idx = Number(el.lane)
        const value = typeof fields['zoomLane.' + idx] === 'string' ? fields['zoomLane.' + idx] : ''
        const routes = await buildZoomRoutes()
        if (Number.isInteger(idx) && idx >= 0 && idx < st.zoomLanes.length && (value === '' || routes.some((r) => r.value === value))) {
          st.zoomLanes = st.zoomLanes.map((v, i) => (i === idx ? value : v))
          const meta = routes.find((r) => r.value === value)
          const prior = st.zoomEfforts[idx] || ''
          st.zoomEfforts = st.zoomEfforts.map((v, i) => (i === idx && (!meta || !meta.efforts.some((e) => e.id === prior)) ? '' : v))
        }
      }
      else if (action === 'fzoom-effort') {
        const idx = Number(el.lane)
        const value = typeof fields['zoomEffort.' + idx] === 'string' ? fields['zoomEffort.' + idx] : ''
        const routes = await buildZoomRoutes()
        const meta = routes.find((r) => r.value === st.zoomLanes[idx])
        if (Number.isInteger(idx) && idx >= 0 && idx < st.zoomEfforts.length && (value === '' || (meta && meta.efforts.some((e) => e.id === value)))) {
          st.zoomEfforts = st.zoomEfforts.map((v, i) => (i === idx ? value : v))
        }
      }
      else if (action === 'fzoom-lane-add' && st.zoomLanes.length < 4) {
        st.zoomLanes = [...st.zoomLanes, '']
        st.zoomEfforts = [...st.zoomEfforts, '']
      }
      else if (action === 'fzoom-lane-del' && st.zoomLanes.length > 2) {
        st.zoomLanes = st.zoomLanes.slice(0, -1)
        st.zoomEfforts = st.zoomEfforts.slice(0, -1)
      }
      else if (action === 'fzoom-lanes') {
        const count = Math.max(2, Math.min(4, Number(el.count) || 2))
        while (st.zoomLanes.length < count) { st.zoomLanes.push(''); st.zoomEfforts.push('') }
        st.zoomLanes = st.zoomLanes.slice(0, count)
        st.zoomEfforts = st.zoomEfforts.slice(0, count)
      }
      else if (action === 'fzoom-joined' && typeof el.sids === 'string') {
        // ;,.
        const sids = el.sids.split(',').map((s) => s.trim()).filter((s) => /^[\w-]{1,80}$/.test(s))
        if (sids.length) {
          let meta = {}
          try { meta = el.meta ? JSON.parse(el.meta) : {} } catch (e) {}
          const now = Date.now()
          let base = typeof meta.baseHistoryId === 'string' ? st.zoomRuns.find((x) => x.id === meta.baseHistoryId) : null
          let baseAt = base && typeof meta.baseRoundId === 'string' ? base.rounds.findIndex((x) => x.id === meta.baseRoundId) : -1
          //  1→N :Client (linkSource), Host
          // /——,,.
          if (!base && typeof meta.linkSource === 'string' && /^[\w-]{1,80}$/.test(meta.linkSource)) {
            const hit = latestZoomRunForSession(st.zoomRuns, meta.linkSource)
            if (hit) { base = hit.run; baseAt = hit.run.rounds.findIndex((x) => x.id === hit.round.id) }
          }
          const appendExisting = !!(base && baseAt === base.rounds.length - 1 && !st.zoomRuns.some((x) => x.parentId === base.id))
          const prefix = base ? base.rounds.slice(0, baseAt >= 0 ? baseAt + 1 : base.rounds.length).map((x) => ({ ...x, sids: x.sids.slice(), sourceSids: x.sourceSids.slice(), routes: x.routes.slice(), efforts: x.efforts.slice() })) : []
          const sourceSids = Array.isArray(meta.sourceSids) ? [...new Set(meta.sourceSids.map(String).filter((s) => /^[\w-]{1,80}$/.test(s)))].slice(0, 4) : []
          if (!base && sourceSids.length) prefix.push({ id: 'round-' + now.toString(36) + '-0-initial', kind: 'initial', at: now, prompt: '', sourceSids: [], sids: sourceSids, routes: sourceSids.map(() => ''), efforts: sourceSids.map(() => '') })
          const round = {
            id: 'round-' + now.toString(36) + '-' + prefix.length + '-' + hashText(sids.join(',')), kind: prefix.length ? 'round' : 'initial', at: now,
            prompt: typeof meta.prompt === 'string' ? meta.prompt.slice(0, 240) : '',
            sourceSids: sourceSids.length ? sourceSids : (prefix.length ? prefix[prefix.length - 1].sids.slice() : []),
            sids: [...new Set(sids)].slice(0, 4),
            routes: Array.isArray(meta.routes) ? meta.routes.map(String).slice(0, sids.length) : [],
            efforts: Array.isArray(meta.efforts) ? meta.efforts.map(String).slice(0, sids.length) : [],
          }
          prefix.push(round)
          const run = appendExisting ? base : {
            id: 'run-' + now.toString(36) + '-' + st.zoomRuns.length + '-' + hashText(sids.join(',')), at: now,
            prompt: typeof meta.prompt === 'string' ? meta.prompt.slice(0, 240) : '',
            name: ' ' + String.fromCharCode(65 + (st.zoomRuns.length % 26)),
            parentId: base ? base.id : '', forkRoundId: base && baseAt >= 0 ? base.rounds[baseAt].id : '', rounds: [],
            sids: [], routes: [], efforts: [],
          }
          run.rounds = prefix
          run.prompt = typeof meta.prompt === 'string' ? meta.prompt.slice(0, 240) : run.prompt
          run.sids = round.sids; run.routes = round.routes; run.efforts = round.efforts
          if (!appendExisting) st.zoomRuns = [...st.zoomRuns, run].slice(-20)
          st.zoomRunId = run.id
          st.zoomRoundId = round.id
          st.zoomScope = 'run'
          st.zoom = true
          st.zoomFocusSid = ''
        }
      }
      else if (action === 'fzoom-run') {
        const id = typeof el.run === 'string' ? el.run : (typeof fields.zoomRunId === 'string' ? fields.zoomRunId : '')
        if (st.zoomRuns.some((x) => x.id === id)) {
          st.zoomRunId = id
          const run = st.zoomRuns.find((x) => x.id === id)
          st.zoomRoundId = run.rounds[run.rounds.length - 1].id
          st.zoomScope = 'run'
          st.zoom = true
          st.zoomFocusSid = ''
          st.zoomHistoryOpen = false
        }
      }
      else if (action === 'fzoom-round') {
        const run = st.zoomRuns.find((x) => x.id === el.run)
        if (run && run.rounds.some((x) => x.id === el.round)) {
          st.zoomRunId = run.id; st.zoomRoundId = el.round; st.zoomScope = 'run'; st.zoom = true; st.zoomFocusSid = ''; st.zoomHistoryOpen = false
        }
      }
      else if (action === 'fzoom-run-add' && typeof el.sid === 'string' && /^[\w-]{1,100}$/.test(el.sid)) {
        const run = st.zoomRuns.find((x) => x.id === st.zoomRunId)
        const round = run && (run.rounds.find((x) => x.id === st.zoomRoundId) || run.rounds[run.rounds.length - 1])
        if (run && round && !round.sids.includes(el.sid) && round.sids.length < 4) {
          round.sids.push(el.sid); round.routes.push(''); round.efforts.push('')
          run.sids = round.sids; run.routes = round.routes; run.efforts = round.efforts
        }
      }
      else if (action === 'fzoom-run-remove' && typeof el.sid === 'string') {
        const run = st.zoomRuns.find((x) => x.id === st.zoomRunId)
        const round = run && (run.rounds.find((x) => x.id === st.zoomRoundId) || run.rounds[run.rounds.length - 1])
        if (run && round && round.sids.length > 1) {
          const at = round.sids.indexOf(el.sid)
          if (at >= 0) {
            round.sids.splice(at, 1); round.routes.splice(at, 1); round.efforts.splice(at, 1)
            run.sids = round.sids; run.routes = round.routes; run.efforts = round.efforts
            if (st.zoomFocusSid === el.sid) st.zoomFocusSid = ''
          }
        }
      }
      else if (action === 'fzoom-relay' && typeof el.sid === 'string' && el.sid) {
        // :, Client /("")
        const r = await readLog(el.sid)
        const items = parseItems(r.events || [])
        let lastAi = null
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i]
          if (it.kind === 'msg' && it.role === 'ai' && it.full && !it.streaming) { lastAi = it; break }
        }
        if (!lastAi) return { ok: false, error: '', html: '', state: st }
        const text = String(lastAi.full)
        zoomRelay = {
          sourceSessionId: el.sid,
          text: '[ ' + el.sid.replace(/^session-/, '').slice(0, 8) + ' ]\n' + (text.length > 12000 ? text.slice(0, 12000) + '\n…(, ' + text.length + ' )' : text),
        }
      }
      else if (action === 'fzoom-open' && typeof el.sid === 'string' && el.sid) {
        // ,;.
        // Harness  Session , zoomMode .
        const target = el.sid
        if (typeof el.run === 'string' && st.zoomRuns.some((x) => x.id === el.run)) {
          st.zoomRunId = el.run
          const run = st.zoomRuns.find((x) => x.id === el.run)
          if (run && typeof el.round === 'string' && run.rounds.some((x) => x.id === el.round)) st.zoomRoundId = el.round
          st.zoomScope = 'run'
        }
        st.zoom = true
        st.zoomMode = 'near'
        st.zoomFocusSid = target
        st.zoomLastFocusSid = target
        st.zoomMotion = 'focus'
        st.expanded = null
        if (target !== st.sid) {
          st.sid = target
          if (st.follow) {
            let hdr = null
            try { const ss = ctx.get('sessions'); const liveS = ss && typeof ss.get === 'function' ? ss.get(target) : null; if (liveS) hdr = liveS.header } catch (e) {}
            if (!hdr) { try { const rr = await readLog(target); hdr = rr.header || null } catch (e) {} }
            const parent = hdr && typeof hdr.parentSession === 'string' ? hdr.parentSession : ''
            navigateSession = hdr && hdr.origin === 'subagent' && parent
              ? { sessionId: target, parentSessionId: parent, kind: 'subagent' }
              : { sessionId: target, kind: 'session' }
          }
        }
      }
      else if (action === 'fsettings') {
        const opening = !st.settings
        st.settings = opening
        if (opening) st.freshSettings = true
        st.expanded = null
        st.ruleNotice = ''
      }
      else if (action === 'fsave-rule') {
        const index = Number(el.index)
        if (!Number.isInteger(index) || index < 0 || index >= st.presentationRules.length) throw new Error('Invalid presentation rule index')
        const next = normalizePresentationRules([ruleFromFields(fields, 'flowRule.' + index)])[0]
        st.presentationRules = st.presentationRules.map((rule, at) => at === index ? next : rule)
        st.settings = true
        st.ruleNotice = 'Saved rule ' + (index + 1)
      }
      else if (action === 'fcreate-rule') {
        if (st.presentationRules.length >= MAX_PRESENTATION_RULES) throw new Error('At most ' + MAX_PRESENTATION_RULES + ' presentation rules are allowed')
        const next = normalizePresentationRules([ruleFromFields(fields, 'flowRule.new')])[0]
        st.presentationRules = [...st.presentationRules, next]
        st.settings = true
        st.ruleNotice = 'Created rule ' + st.presentationRules.length
      }
      else if (action === 'fapply-rule-json') {
        st.presentationRules = normalizePresentationRules(fields.flowPresentationRules || '[]')
        st.settings = true
        st.ruleNotice = 'Applied ' + st.presentationRules.length + ' rules from JSON'
      }
      else if (action === 'ftoggle-rule') {
        const index = Number(el.index)
        if (!Number.isInteger(index) || index < 0 || index >= st.presentationRules.length) throw new Error('Invalid presentation rule index')
        st.presentationRules = st.presentationRules.map((rule, at) => at === index ? { ...rule, enabled: !rule.enabled } : rule)
        st.settings = true
        st.ruleNotice = (st.presentationRules[index].enabled ? 'Enabled rule ' : 'Disabled rule ') + (index + 1)
      }
      else if (action === 'fdelete-rule') {
        const index = Number(el.index)
        if (!Number.isInteger(index) || index < 0 || index >= st.presentationRules.length) throw new Error('Invalid presentation rule index')
        st.presentationRules = st.presentationRules.filter((_rule, at) => at !== index)
        st.settings = true
        st.ruleNotice = 'Deleted rule ' + (index + 1)
      }
      else if (action === 'freset-rules') {
        st.presentationRules = []
        st.settings = true
        st.ruleNotice = 'Cleared all rules'
      }
      else if (action === 'fmore') st.limit = Math.min(100000, Number(st.limit) + 60)
      else if (action === 'fcontext' && typeof el.seqs === 'string') {
        const seqs = el.seqs.split(',').map((v) => Number(v)).filter((v) => Number.isFinite(v))
        const r = await readLog(st.sid)
        flowContext = flowContextOf(parseItems(r.events || [], liveOverlay), seqs, st.sid)
      }
      else if (action === 'fdetail' && el.seq != null) {
        const seq = Number(el.seq)
        st.expanded = st.expanded === seq ? null : seq
        st.freshSeq = st.expanded // (null=;)
      } else if (action === 'fenter' && el.seq != null) {
        // :, id ()
        const seq = Number(el.seq)
        const r = await readLog(st.sid)
        const call = parseItems(r.events || []).find((it) => it.kind === 'call' && it.seq === seq && it.cat === 'subagent')
        const cid = call ? childIdOf(call) : null
        if (cid && cid !== st.sid) {
          const parentSid = st.sid
          st.crumbs.push({ sid: st.sid, label: call.name + ' ' + cid.slice(0, 8) })
          st.sid = cid
          st.expanded = null
          if (st.follow) navigateSession = { sessionId: cid, parentSessionId: parentSid, kind: 'subagent' }
        }
      } else if (action === 'fback') {
        const prev = st.crumbs.pop()
        if (prev && prev.sid) {
          st.sid = prev.sid
          st.expanded = null
          if (prev.zoom === true) st.zoom = true // :
          if (st.follow) navigateSession = { sessionId: prev.sid, kind: 'session' }
        }
      }
      const sid = st.sid
      try {
        const html = await render(st, sid, liveOverlay)
        try { delete st.__flowPreferences } catch (e) {}
        try { delete st.__zoomSessionIndex } catch (e) {}
        try { delete st.__archivedSessionIds } catch (e) {}
        return { ok: true, html, state: st, navigateSession, flowContext, zoomRelay }
      } catch (e) {
        try { delete st.__flowPreferences } catch (err) {}
        try { delete st.__zoomSessionIndex } catch (err) {}
        try { delete st.__archivedSessionIds } catch (err) {}
        return { ok: false, error: String((e && e.message) || e), html: '', state: st }
      }
    }

    tryRegisterTool(ctx, { id: 'flow', label: '', order: 2, icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="3" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><path d="M8 4.5v2.2M8 6.7L4 11M8 6.7l4 4.3"/></svg>' }, handler)
  },
}
