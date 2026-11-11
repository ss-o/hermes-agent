import { createRequire } from 'node:module'
import { PassThrough } from 'stream'

import { renderSync } from '@hermes/ink'
import { stripAnsi } from '@hermes/shared/ansi'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GatewayProvider } from '../app/gatewayContext.js'
import type { AppLayoutProps, OverlayState, UiState } from '../app/interfaces.js'
import { patchOverlayState, resetOverlayState } from '../app/overlayStore.js'
import { patchTurnState, resetTurnState } from '../app/turnStore.js'
import { patchUiState, resetUiState } from '../app/uiStore.js'
import { $voicePartial } from '../app/voicePartialStore.js'
import { StatusRule } from '../components/appChrome.js'
import { AppLayout } from '../components/appLayout.js'
import type { GatewayClient } from '../gatewayClient.js'
import { applyLocale, resetLocale } from '../i18n/runtime.js'
import { DEFAULT_VOICE_RECORD_KEY, isMac } from '../lib/platform.js'
import { DEFAULT_THEME } from '../theme.js'

type StatusRuleProps = React.ComponentProps<typeof StatusRule>
type IntervalSpy = ReturnType<typeof vi.spyOn<typeof globalThis, 'setInterval'>>

const { load } = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown }

// Fixed wall clock so the rendered elapsed read-outs are exact strings rather
// than whatever the machine's clock happens to produce mid-test.
const T0 = 1_800_000_000_000

const mounted: Array<() => void> = []

/**
 * Mount a real StatusRule through Ink so the leaf components' effects — and
 * therefore their `setInterval` calls — actually run.  The existing
 * appChromeStatusRule tests invoke `StatusRule(...)` as a plain function,
 * which only builds the element tree and never mounts the busy ticker,
 * so it cannot observe timer behaviour.
 *
 * Teardown is registered up front so a failing assertion still unmounts the
 * tree — a leaked instance would keep re-arming timers into the next test.
 */
const mountTree = (tree: React.ReactElement, { interactive = false, columns = 120 } = {}) => {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const stderr = new PassThrough()

  let output = ''

  Object.assign(stdout, { columns, isTTY: false, rows: 20 })
  // PromptZone's prompts call `useInput`, which needs raw mode; without it Ink
  // swaps the whole tree for an error panel and stops updating.
  Object.assign(
    stdin,
    interactive ? { isTTY: true, ref: () => {}, setRawMode: () => {}, unref: () => {} } : { isTTY: false }
  )
  Object.assign(stderr, { isTTY: false })
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  const instance = renderSync(tree, {
    patchConsole: false,
    stderr: stderr as NodeJS.WriteStream,
    stdin: stdin as NodeJS.ReadStream,
    stdout: stdout as NodeJS.WriteStream
  })

  mounted.push(() => {
    instance.unmount()
    instance.cleanup()
  })

  return {
    /** Drop frames rendered so far so `output()` reads only what comes next. */
    clear: () => {
      output = ''
    },
    output: () => stripAnsi(output)
  }
}

const mount = (props: StatusRuleProps) => mountTree(<StatusRule {...props} />)

const idleProps: StatusRuleProps = {
  bgCount: 0,
  busy: false,
  cols: 120,
  cwdLabel: '~/repo',
  lastTurnEndedAt: T0 - 5_000,
  liveSessionCount: 0,
  model: 'opus-4.8',
  sessionStartedAt: T0 - 60_000,
  status: 'ready',
  statusColor: DEFAULT_THEME.color.ok,
  t: DEFAULT_THEME,
  turnStartedAt: null,
  usage: { context_max: 200_000, context_percent: 25, context_used: 50_000, total: 50_000 },
  voiceLabel: ''
}

// Only active work owns a glyph ticker and an elapsed clock.
const busyProps: StatusRuleProps = {
  ...idleProps,
  busy: true,
  indicatorStyle: 'kaomoji',
  lastTurnEndedAt: null,
  turnStartedAt: T0 - 30_000
}

/** Delays of every interval armed while the spy was installed. */
const armedDelays = (spy: IntervalSpy) => spy.mock.calls.map(call => call[1])

const oneSecondTimers = (spy: IntervalSpy) => armedDelays(spy).filter(delay => delay === 1000).length

/** The handlers of every 1s clock armed so far — `() => setNow(Date.now())`. */
const oneSecondTicks = (spy: IntervalSpy) =>
  spy.mock.calls.filter(call => call[1] === 1000).map(call => call[0] as () => void)

// ── AppLayout harness ────────────────────────────────────────────────
//
// teknium1's review of this file was right that mounting StatusRule alone
// proves the store pauses timers but NOT that the overlay in question covers
// the status rule.  These props render the real AppLayout so the rule sits in
// its true position relative to PromptZone / FloatingOverlays / the widget
// slot, and the assertions can read what is actually on screen.

const gatewayStub = {
  gw: {
    request: () => new Promise<never>(() => {}),
    send: () => {}
  } as unknown as GatewayClient,
  rpc: (() => new Promise<never>(() => {})) as never
}

const layoutProps: AppLayoutProps = {
  actions: {
    activateLiveSession: () => {},
    answerApproval: () => {},
    answerSecret: () => {},
    answerSudo: () => {},
    cancelClarify: () => {},
    clearSelection: () => {},
    closeLiveSession: () => Promise.resolve(null),
    newLiveSession: () => {},
    newPromptSession: () => {},
    onModelSelect: () => {},
    resumeById: () => {},
    setStickyPrompt: () => {}
  },
  composer: {
    cols: 120,
    compIdx: 0,
    completions: [],
    empty: true,
    handleTextPaste: () => null,
    input: '',
    inputBuf: [],
    pagerPageSize: 10,
    queueEditIdx: null,
    queuedDisplay: [],
    submit: () => {},
    updateInput: () => {},
    voiceRecordKey: DEFAULT_VOICE_RECORD_KEY
  },
  mouseTracking: 'off',
  progress: { showProgressArea: false },
  status: {
    cwdLabel: '~/repo',
    goodVibesTick: 0,
    lastTurnEndedAt: T0 - 5_000,
    sessionStartedAt: T0 - 60_000,
    sessionTitle: '',
    showStickyPrompt: false,
    statusColor: DEFAULT_THEME.color.ok,
    stickyPrompt: '',
    turnStartedAt: T0 - 30_000,
    voiceLabel: ''
  },
  transcript: {
    historyItems: [],
    scrollRef: { current: null },
    virtualHistory: {
      bottomSpacer: 0,
      end: 0,
      measureRef: () => () => {},
      offsets: [],
      start: 0,
      topSpacer: 0
    },
    virtualRows: []
  }
}

/** Mount the real AppLayout with the given overlay + ui state applied first. */
const mountLayout = (
  overlay: Partial<OverlayState> = {},
  ui: Partial<UiState> = {},
  composer: Partial<AppLayoutProps['composer']> = {}
) => {
  patchUiState({ busy: true, sessionTitle: 'test', sid: 'sid-1', status: 'running…', ...ui })
  patchOverlayState(overlay)

  return mountTree(
    <GatewayProvider value={gatewayStub}>
      <AppLayout {...layoutProps} composer={{ ...layoutProps.composer, ...composer }} />
    </GatewayProvider>,
    { interactive: true, columns: composer.cols ?? 120 }
  )
}

// Give React's scheduler a turn so a store-driven re-render (and the effect
// re-arm that follows it) lands before we assert.
const flush = () => new Promise(resolve => setTimeout(resolve, 20))

let intervalSpy: IntervalSpy
let nowSpy: ReturnType<typeof vi.spyOn<typeof Date, 'now'>>

beforeEach(() => {
  resetLocale()
  resetOverlayState()
  resetUiState()
  resetTurnState()
  $voicePartial.set('')
  nowSpy = vi.spyOn(Date, 'now').mockReturnValue(T0)
  intervalSpy = vi.spyOn(globalThis, 'setInterval')
})

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()!()
  }

  intervalSpy.mockRestore()
  nowSpy.mockRestore()
  resetOverlayState()
  resetUiState()
  resetTurnState()
})

describe('status-chrome timers under an occluding overlay', () => {
  it('arms no idle clocks even when nothing covers the rule', () => {
    mount(idleProps)

    expect(oneSecondTimers(intervalSpy)).toBe(0)
  })

  it('arms no timer at all when an occluding overlay is already open', () => {
    patchOverlayState({ modelPicker: true })

    mount(idleProps)

    expect(oneSecondTimers(intervalSpy)).toBe(0)
  })

  it('arms one glyph ticker and one clock without random verb rotation', () => {
    mount(busyProps)

    expect(armedDelays(intervalSpy).filter(delay => delay === 2500)).toHaveLength(1)
    expect(oneSecondTimers(intervalSpy)).toBe(1)
  })

  it('freezes the FaceTicker verb on compacting and skips verb rotation (#97239)', () => {
    const { output } = mount({ ...busyProps, compacting: true })

    expect(output()).toContain('compacting')
    // Glyph still ticks at the kaomoji cadence; the rotating-verb timer does not.
    expect(armedDelays(intervalSpy).filter(delay => delay === 2500)).toHaveLength(1)
    expect(oneSecondTimers(intervalSpy)).toBeGreaterThan(0)
  })

  it('arms no FaceTicker timer mid-turn while the modal widget slot is open', () => {
    patchOverlayState({ widget: { appId: 'demo', state: null } })

    mount(busyProps)

    expect(armedDelays(intervalSpy)).not.toContain(2500)
    expect(oneSecondTimers(intervalSpy)).toBe(0)
  })

  it('keeps the FaceTicker running mid-turn under a flow-layout sudo prompt', () => {
    // `sudo` is in `$isBlocked` but renders in PromptZone's normal flow, so it
    // pushes the rule down rather than covering it — the trio must keep going.
    patchOverlayState({ sudo: { requestId: 'sudo-1' } })

    mount(busyProps)

    expect(armedDelays(intervalSpy)).toContain(2500)
    expect(oneSecondTimers(intervalSpy)).toBeGreaterThan(0)
  })

  it('keeps the clocks running when a floating overlay cannot reach a bottom status rule', () => {
    // FloatingOverlays is `position="absolute" bottom="100%"` inside
    // ComposerPane's relative Box, so it grows UPWARD: it covers the `at="top"`
    // rule and never the `at="bottom"` one.
    patchUiState({ statusBar: 'bottom' })
    patchOverlayState({ modelPicker: true })

    mount(busyProps)

    expect(oneSecondTimers(intervalSpy)).toBe(1)
  })

  it('re-syncs the live turn clock from wall time when the rule is revealed', async () => {
    patchOverlayState({ sessions: true })

    const rule = mount(busyProps)

    expect(rule.output()).toContain('30s')

    // Five minutes of wall clock elapse while the overlay covers the rule.
    nowSpy.mockReturnValue(T0 + 300_000)
    rule.clear()
    resetOverlayState()
    // Poll for the reveal frame instead of a fixed tick: under CI load the
    // store-driven re-render can land well after one 20ms scheduler turn.
    await vi.waitFor(() => expect(rule.output()).toContain('5m 30s'), { interval: 10, timeout: 5_000 })

    const resumed = rule.output()

    // Caught up to real elapsed time, not stuck on the pre-overlay values.
    expect(resumed).toContain('5m 30s')
    expect(resumed).not.toContain('✓')

    expect(oneSecondTimers(intervalSpy)).toBe(1)
  })

  it('tears the clocks down when an overlay opens over an already-running status rule', async () => {
    mount(busyProps)

    // The live turn clock must be cleared, not replaced while occluded.
    const clocks = intervalSpy.mock.results
      .filter((_result, i) => intervalSpy.mock.calls[i]?.[1] === 1000)
      .map(result => result.value as ReturnType<typeof setInterval>)

    expect(clocks).toHaveLength(1)

    const clearSpy = vi.spyOn(globalThis, 'clearInterval')

    patchOverlayState({ pluginsHub: true })
    await flush()

    // Each running clock is cleared as the overlay goes up …
    for (const handle of clocks) {
      expect(clearSpy).toHaveBeenCalledWith(handle)
    }

    expect(oneSecondTimers(intervalSpy)).toBe(1)

    clearSpy.mockRestore()
  })
})

// teknium1's review of #12463 called out that its test asserted on a `picker`
// overlay state that no longer exists.  Pin the gate to fields the current
// OverlayState actually carries so a rename breaks this file loudly.
describe('status-chrome timers track the current overlay model', () => {
  // Everything that genuinely paints over the rule: the modal widget slot,
  // plus the FloatingOverlays set (with the rule at its default `top`).
  const occluding: Array<[string, Partial<OverlayState>]> = [
    ['modelPicker', { modelPicker: true }],
    ['pager', { pager: { lines: ['a'], offset: 0 } }],
    ['petPicker', { petPicker: true }],
    ['pluginsHub', { pluginsHub: true }],
    ['sessions', { sessions: true }],
    ['skillsHub', { skillsHub: true }],
    ['widget', { widget: { appId: 'demo', state: null } }]
  ]

  // In `$isBlocked` but NOT occluding.  `agents` / `journey` unmount the whole
  // ComposerPane subtree, so React's effect cleanup already stops the clocks
  // and gating on them would be dead code; the rest are PromptZone states that
  // render in normal flow and push the rule down without covering it.
  const nonOccluding: Array<[string, Partial<OverlayState>]> = [
    ['agents', { agents: true }],
    ['approval', { approval: { command: 'ls', requestId: 'a-1' } as OverlayState['approval'] }],
    ['billing', { billing: { kind: 'credits' } as OverlayState['billing'] }],
    ['clarify', { clarify: { questions: [{ choices: null, qid: 'q0', question: 'which?' }], requestId: 'c-1' } }],
    ['confirm', { confirm: { onConfirm: () => {}, prompt: 'sure?' } as OverlayState['confirm'] }],
    ['journey', { journey: true }],
    ['secret', { secret: { envVar: 'TOKEN', prompt: 'token?' } as OverlayState['secret'] }],
    ['subscription', { subscription: { kind: 'expired' } as OverlayState['subscription'] }],
    ['sudo', { sudo: { requestId: 'sudo-1' } as OverlayState['sudo'] }]
  ]

  it.each(occluding)('pauses the status clocks while %s covers the rule', (_name, patch) => {
    patchOverlayState(patch)

    mount(busyProps)

    expect(oneSecondTimers(intervalSpy)).toBe(0)
  })

  it.each(nonOccluding)('keeps the status clocks running while %s is open', (_name, patch) => {
    patchOverlayState(patch)

    mount(busyProps)

    expect(oneSecondTimers(intervalSpy)).toBe(1)
  })

  it('keeps the clocks running for the non-occluding ambient dock', () => {
    // `ambient` is a glanceable in-flow dock that reserves its own rows and
    // doesn't cover the status rule, so pausing there would be a regression.
    patchOverlayState({ ambient: [{ appId: 'clock', state: null }] })

    mount(busyProps)

    expect(oneSecondTimers(intervalSpy)).toBe(1)
  })
})

// The visibility gate teknium1 asked for: mount the REAL AppLayout so the
// status rule sits in its true position relative to PromptZone (normal flow,
// above ComposerPane) and FloatingOverlays (absolute, growing upward), then
// assert on what is actually on screen rather than on the store alone.
describe('AppLayout status-rule visibility', () => {
  it('keeps the status rule on screen AND its clock advancing under a flow-layout approval prompt', async () => {
    const layout = mountLayout({ approval: { command: 'rm -rf /', requestId: 'a-1' } as OverlayState['approval'] })

    await flush()

    // The rule is genuinely rendered — the approval prompt pushed it, it did
    // not cover it — so freezing its clock would freeze something visible.
    expect(layout.output()).toContain('~/repo')
    expect(layout.output()).toContain('30s')
    expect(oneSecondTimers(intervalSpy)).toBe(1)

    // …and it really advances: drive the armed 1s handlers forward.
    nowSpy.mockReturnValue(T0 + 30_000)

    for (const tick of oneSecondTicks(intervalSpy)) {
      tick()
    }

    await flush()
    await flush()

    expect(layout.output()).toContain('1m 0s')
  })

  it('arms no clock under a floating model picker while the rule is at the top', async () => {
    mountLayout({ modelPicker: true }, { statusBar: 'top' })

    await flush()

    expect(oneSecondTimers(intervalSpy)).toBe(0)
  })

  it('keeps the clocks armed under a floating model picker while the rule is at the bottom', async () => {
    mountLayout({ modelPicker: true }, { statusBar: 'bottom' })

    await flush()

    expect(oneSecondTimers(intervalSpy)).toBe(1)
  })

  it('uses the current tool roster and returns to generic activity when tools finish', async () => {
    patchTurnState({
      tools: [
        { id: 'one', name: 'terminal' },
        { id: 'two', name: 'read_file' }
      ]
    })
    const layout = mountLayout({}, { info: { model: 'test-model', yolo: true } as UiState['info'] })

    expect(layout.output()).toContain('terminal +1')
    expect(layout.output()).toContain('⚠ YOLO')
    patchTurnState({ tools: [] })
    await vi.waitFor(() => expect(layout.output()).toContain('running…'), { interval: 10, timeout: 5_000 })
  })
})

describe('composer action hints', () => {
  it('keeps the stop action complete when a profile name leaves too little room for both actions', async () => {
    const layout = mountLayout(
      {},
      {
        busy: true,
        busyInputMode: 'interrupt',
        info: { model: 'test', tools: {}, skills: {}, profile_name: 'research' }
      },
      { cols: 40 }
    )

    await flush()

    expect(layout.output()).toContain('Ctrl+C: stop')
    expect(layout.output()).not.toContain('Enter: interrupt')
  })

  it.each(['queue', 'steer', 'interrupt'] as const)(
    'keeps both %s and stop actions complete at 40 columns',
    async busyInputMode => {
      const layout = mountLayout({}, { busy: true, busyInputMode }, { cols: 40 })

      await flush()

      expect(layout.output()).toContain(`Enter: ${busyInputMode} · Ctrl+C: stop`)
    }
  )

  it('does not let an old translated interrupt key replace the new Enter guidance', async () => {
    applyLocale('de', {
      lang: 'de',
      surface: 'tui',
      messages: { 'composer.interruptHint': 'Ctrl+C zum Unterbrechen…' }
    })
    const layout = mountLayout({}, { busy: true, busyInputMode: 'interrupt' })

    await flush()

    expect(layout.output()).toContain('Enter interrupts and sends')
  })

  it.each([
    ['queue', 'Enter queues next message'],
    ['steer', 'Enter steers current turn'],
    ['interrupt', 'Enter interrupts and sends']
  ] as const)('describes Enter in %s mode on fresh and existing transcripts', async (busyInputMode, hint) => {
    for (const empty of [true, false]) {
      const layout = mountLayout({}, { busy: true, busyInputMode }, { empty })

      await flush()

      expect(layout.output()).toContain(hint)
      expect(layout.output()).toContain('Ctrl+C stops')
      mounted.pop()!()
    }
  })

  it('shows command, file, help and editor affordances when idle', async () => {
    const layout = mountLayout({}, { busy: false }, { empty: false })

    await flush()

    expect(layout.output()).toContain(`/ commands · @ files · ? help · ${isMac ? 'Cmd' : 'Ctrl'}+G editor`)
  })

  it('prioritizes live transcription without replacing a typed draft', async () => {
    $voicePartial.set('live dictation')

    const layout = mountLayout({}, { busy: true, busyInputMode: 'queue' })

    await flush()

    expect(layout.output()).toContain('live dictation')
    expect(layout.output()).not.toContain('Enter queues')
    mounted.pop()!()

    const draft = mountLayout({}, { busy: true }, { input: 'my draft' })

    await flush()

    expect(draft.output()).toContain('my draft')
    expect(draft.output()).not.toContain('live dictation')
  })
})
