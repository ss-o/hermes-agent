import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { fromSkin } from '../theme.js'

let home: string | undefined

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.resetModules()

  if (home) {
    rmSync(home, { recursive: true, force: true })
    home = undefined
  }
})

it('keeps a real cached skin until readiness, then still follows live detection', async () => {
  vi.useFakeTimers()
  home = mkdtempSync(join(tmpdir(), 'ink-theme-cache-'))
  const cached = fromSkin({ ui_accent: '#7eb8f6' }, {})

  writeFileSync(join(home, 'tui-theme-boot.json'), JSON.stringify({ version: 1, theme: cached }))
  vi.stubEnv('HERMES_HOME', home)
  vi.stubEnv('VITEST', '')
  vi.stubEnv('NODE_ENV', '')
  vi.stubEnv('HERMES_TUI_BACKGROUND', '#0d1117')
  vi.stubEnv('HERMES_TUI_THEME', '')
  vi.stubEnv('HERMES_TUI_LIGHT', '')
  vi.resetModules()

  const { getUiState } = await import('../app/uiStore.js')
  const { createGatewayEventHandler, reapplyTheme } = await import('../app/createGatewayEventHandler.js')

  expect(getUiState().theme.color.accent).toBe('#7eb8f6')
  reapplyTheme()
  expect(getUiState().theme.color.accent).toBe('#7eb8f6')

  const noop = () => {}
  const pending = () => new Promise<never>(() => {})

  const onEvent = createGatewayEventHandler({
    composer: { setInput: noop },
    gateway: { gw: { request: pending }, rpc: pending },
    session: {
      STARTUP_RESUME_ID: '',
      colsRef: { current: 80 },
      newSession: noop,
      resumeById: pending,
      setCatalog: noop
    },
    submission: { submitRef: { current: noop }, submitLiteralRef: { current: noop } },
    system: { bellOnComplete: false, sys: noop },
    transcript: { appendMessage: noop, panel: noop, setHistoryItems: noop },
    voice: { setProcessing: noop, setRecording: noop, setVoiceEnabled: noop, setVoiceTts: noop }
  } as never)

  onEvent({ type: 'gateway.ready', payload: { skin: { colors: { ui_accent: '#ff0000' } } } } as never)
  expect(getUiState().theme.color.accent).toBe('#ff0000')
  const darkText = getUiState().theme.color.text

  vi.stubEnv('HERMES_TUI_BACKGROUND', '#ffffff')
  reapplyTheme()
  expect(getUiState().theme.color.text).not.toBe(darkText)
  onEvent({ type: 'gateway.ready', payload: { skin: {} } } as never)
  expect(getUiState().theme.color.accent).not.toBe('#ff0000')
})
