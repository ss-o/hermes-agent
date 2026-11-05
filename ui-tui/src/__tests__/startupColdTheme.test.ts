import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('corrects a cold-start palette when a light background arrives before gateway readiness', async () => {
  vi.stubEnv('HERMES_TUI_THEME', '')
  vi.stubEnv('HERMES_TUI_LIGHT', '')
  vi.stubEnv('HERMES_TUI_BACKGROUND', '#0d1117')
  vi.stubEnv('COLORFGBG', '')
  vi.stubEnv('TERM_PROGRAM', '')
  vi.resetModules()

  const { reapplyTheme } = await import('../app/createGatewayEventHandler.js')
  const { getUiState } = await import('../app/uiStore.js')
  const { LIGHT_THEME } = await import('../theme.js')

  vi.stubEnv('HERMES_TUI_BACKGROUND', '#ffffff')
  expect(getUiState().theme.color.text).not.toBe(LIGHT_THEME.color.text)

  reapplyTheme()

  expect(getUiState().theme.color.text).toBe(LIGHT_THEME.color.text)
})
