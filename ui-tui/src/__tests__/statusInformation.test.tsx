import { PassThrough } from 'stream'

import { renderSync, stringWidth } from '@hermes/ink'
import { stripAnsi } from '@hermes/shared/ansi'
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { resetOverlayState } from '../app/overlayStore.js'
import { resetTurnState } from '../app/turnStore.js'
import { StatusRule } from '../components/appChrome.js'
import { faces } from '../content/faces.js'
import { DEFAULT_THEME } from '../theme.js'

const NOW = 1_800_000_000_000
const cleanup: Array<() => void> = []

const props: React.ComponentProps<typeof StatusRule> = {
  bgCount: 0,
  busy: false,
  cols: 160,
  cwdLabel: '~/repo (main)',
  lastTurnEndedAt: NOW - 300_000,
  liveSessionCount: 1,
  model: 'gpt-6.1-sol-900k',
  sessionStartedAt: NOW - 2_400_000,
  status: 'ready',
  statusColor: DEFAULT_THEME.color.ok,
  t: DEFAULT_THEME,
  turnStartedAt: null,
  usage: { context_max: 900_000, context_percent: 10, context_used: 90_000 }
}

const mount = (overrides: Partial<typeof props> = {}) => {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const stderr = new PassThrough()
  let output = ''

  Object.assign(stdout, { columns: overrides.cols ?? props.cols, isTTY: false, rows: 20 })
  Object.assign(stdin, { isTTY: false })
  Object.assign(stderr, { isTTY: false })
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  const instance = renderSync(<StatusRule {...props} {...overrides} />, {
    patchConsole: false,
    stderr: stderr as NodeJS.WriteStream,
    stdin: stdin as NodeJS.ReadStream,
    stdout: stdout as NodeJS.WriteStream
  })

  cleanup.push(() => {
    instance.unmount()
    instance.cleanup()
  })

  return { clear: () => { output = '' }, output: () => stripAnsi(output), rerender: instance.rerender }
}

afterEach(() => {
  cleanup.splice(0).forEach(fn => fn())
  vi.restoreAllMocks()
  vi.useRealTimers()
  resetOverlayState()
  resetTurnState()
})

it('stays quiet when idle: no session-age or idle-age clocks and no clock intervals', () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  const intervals = vi.spyOn(globalThis, 'setInterval')
  const rule = mount()

  expect(rule.output()).toContain('ready')
  expect(rule.output()).not.toContain('40m')
  expect(rule.output()).not.toContain('5m')
  expect(intervals.mock.calls.filter(call => call[1] === 1000)).toHaveLength(0)
})

it('shows actual activity and a single live turn clock for every indicator style', () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)

  for (const indicatorStyle of ['kaomoji', 'emoji', 'ascii', 'unicode'] as const) {
    const rule = mount({ activityLabel: 'terminal +2', busy: true, indicatorStyle, turnStartedAt: NOW - 12_000 })

    expect(rule.output()).toContain('terminal +2')
    expect(rule.output()).toContain('12s')
    expect(rule.output()).not.toContain('40m')
    expect(rule.output()).not.toMatch(/pondering|musing|synthesizing|contemplating/)
  }
})

it('shows measured context without a decorative bar and never invents missing occupancy', () => {
  expect(mount().output()).toContain('90k/900k 10%')
  expect(mount().output()).not.toMatch(/[█░]/)
  expect(mount({ usage: { context_max: 900_000 } }).output()).not.toContain('0/900k')
  expect(mount({ usage: { total: 500_000 } }).output()).toContain('500k total tok')
  expect(mount({ usage: { ...props.usage, context_estimated: true } }).output()).toContain('~90k/900k 10%')
  expect(mount({ statusBarFields: new Set(['context_pct']) }).output()).toContain('10%')
  expect(mount({ statusBarFields: new Set(['context_detail']) }).output()).not.toContain('10%')
})

it('preserves actionable work ahead of diagnostics and a long workspace label at 80 columns', () => {
  const rule = mount({
    bgCount: 1,
    cols: 80,
    cwdLabel: '~/very/long/workspace/path (a-long-feature-branch)',
    usage: { ...props.usage, active_subagents: 2, cache_hit_pct: 87, avg_latency_s: 3.2, avg_tps: 50 },
    voiceLabel: '● REC'
  })

  expect(rule.output()).toContain('⛓ 2')
  expect(rule.output()).toContain('● REC')
  expect(rule.output()).toContain('1 bg')
  expect(rule.output()).toContain('gpt 6.1 sol 900k')
  expect(rule.output()).toContain('90k/900k 10%')
  expect(rule.output()).not.toContain('87%')
})

it('keeps workspace and branch visible instead of replacing them with the session title', () => {
  const rule = mount({ sessionTitle: 'weekly-digest' })

  expect(rule.output()).toContain('~/repo (main)')
  expect(rule.output()).not.toContain('weekly-digest')
  expect(rule.output()).not.toContain('1 session')
  expect(mount({ liveSessionCount: 2 }).output()).toContain('2 sessions')
})

it('keeps a credit warning visible during active work instead of silently hiding it', () => {
  const rule = mount({
    activityLabel: 'terminal',
    busy: true,
    notice: { key: 'credits.90', kind: 'sticky', level: 'warn', text: '⚠ 90% used' },
    turnStartedAt: NOW
  })

  expect(rule.output()).toContain('terminal')
  expect(rule.output()).toContain('⚠ 90% used')
  expect(rule.output()).toContain('gpt 6.1 sol 900k')
})

it('pins the actual auto-approval warning even when optional fields are filtered out', () => {
  const rule = mount({ cols: 60, statusBarFields: new Set(['context_pct']), yolo: true })

  expect(rule.output()).toContain('⚠ YOLO')
  expect(mount({ yolo: false }).output()).not.toContain('YOLO')
})

it('truncates a long live tool name before it can hide context at 80 columns', () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)

  const rule = mount({
    activityLabel: 'mcp__gopls__go_symbol_references',
    busy: true,
    cols: 80,
    turnStartedAt: NOW - 12_000
  })

  expect(rule.output()).toContain('gpt 6.1 sol 900k')
  expect(rule.output()).toContain('90k/900k 10%')
  expect(rule.output()).toContain('12s')
})

it('keeps the extra active-tool count visible when a long name is truncated', () => {
  const rule = mount({ activityLabel: 'mcp__gopls__go_symbol_references +2', busy: true })

  expect(rule.output()).toContain('mcp__gopls__')
  expect(rule.output()).toContain('+2')
  expect(rule.output()).toContain('90k/900k 10%')
})

it.each(['kaomoji', 'emoji', 'ascii', 'unicode'] as const)(
  'keeps the model and context in fixed columns throughout the %s animation',
  async indicatorStyle => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const intervals = vi.spyOn(globalThis, 'setInterval')
    const rule = mount({ activityLabel: 'terminal', busy: true, indicatorStyle, turnStartedAt: NOW - 12_000 })
    const delay = intervals.mock.calls.find(call => call[1] !== 1000)?.[1]

    expect(delay).toBeTypeOf('number')

    const row = () => {
      const line = rule.output().split('\n').find(line => line.includes('gpt 6.1 sol 900k'))

      expect(line).toBeDefined()
      expect(line).toContain('90k/900k 10%')

      return line!
    }

    const columns = (line: string) => [
      stringWidth(line.slice(0, line.indexOf('gpt 6.1 sol 900k'))),
      stringWidth(line.slice(0, line.indexOf('90k/900k 10%')))
    ]

    const expected = columns(row())
    const frames = new Set([row().split('terminal')[0]])
    const turns = indicatorStyle === 'kaomoji' ? faces().length : 12

    if (indicatorStyle === 'kaomoji') {
      expect(new Set(faces().map(stringWidth)).size).toBeGreaterThan(1)
    }

    for (let tick = 0; tick < turns; tick++) {
      rule.clear()
      await vi.advanceTimersByTimeAsync(delay!)
      await new Promise(resolve => setTimeout(resolve, 20))
      const line = row()

      frames.add(line.split('terminal')[0])
      expect(columns(line)).toEqual(expected)
    }

    expect(frames.size).toBeGreaterThan(1)
  }
)
