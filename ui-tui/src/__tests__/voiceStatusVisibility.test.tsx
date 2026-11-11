import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { renderSync, Text } from '@hermes/ink'
import React from 'react'
import { expect, it } from 'vitest'

import { resetUiState } from '../app/uiStore.js'
import { useMainApp } from '../app/useMainApp.js'

it('hides inactive voice while retaining recording and transcription status', async () => {
  resetUiState()

  const gw = Object.assign(new EventEmitter(), {
    attached: true,
    drain: () => {},
    getLogTail: () => '',
    isCanonical: true,
    kill: () => {},
    recordLog: () => {},
    request: (method: string, params?: Record<string, unknown>) =>
      method === 'voice.toggle'
        ? Promise.resolve({ enabled: params?.action === 'on', tts: params?.action === 'tts' })
        : new Promise(() => {})
  })

  let app!: ReturnType<typeof useMainApp>

  function Harness() {
    app = useMainApp(gw as never)

    return <Text>{app.appStatus.voiceLabel}</Text>
  }

  const stream = () => Object.assign(new PassThrough(), { columns: 120, isTTY: false, rows: 24 })

  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    ref: () => {},
    setRawMode: () => {},
    unref: () => {}
  })

  const instance = renderSync(<Harness />, {
    patchConsole: false,
    stderr: stream() as never,
    stdin: stdin as never,
    stdout: stream() as never
  })

  try {
    expect(app.appStatus.voiceLabel).toBe('')
    gw.emit('event', { type: 'voice.status', payload: { state: 'listening' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(app.appStatus.voiceLabel).toBe('● REC')
    gw.emit('event', { type: 'voice.status', payload: { state: 'transcribing' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(app.appStatus.voiceLabel).toBe('◉ STT')
    gw.emit('event', { type: 'voice.status', payload: { state: 'idle' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(app.appStatus.voiceLabel).toBe('')

    gw.isCanonical = false
    app.appComposer.submit('/voice on')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(app.appStatus.voiceLabel).toBe('voice on')
    app.appComposer.submit('/voice off')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(app.appStatus.voiceLabel).toBe('')
    app.appComposer.submit('/voice tts')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(app.appStatus.voiceLabel).toBe('voice off [tts]')
  } finally {
    instance.unmount()
    instance.cleanup()
    resetUiState()
  }
})
