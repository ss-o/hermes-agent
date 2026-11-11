import { PassThrough } from 'stream'

import { renderSync } from '@hermes/ink'
import { stripAnsi } from '@hermes/shared/ansi'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { MessageLine } from '../components/messageLine.js'
import { ToolTrail } from '../components/thinking.js'
import { DEFAULT_THEME } from '../theme.js'

const TRAIL = ['Alpha("1") ✓', 'Beta("2") ✓', 'Gamma("3") ✓', 'Delta("4") ✓']

const flushEffects = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const trail = (recentTools?: number) => (
  <ToolTrail recentTools={recentTools} sections={{ tools: 'collapsed' }} t={DEFAULT_THEME} trail={TRAIL} />
)

const mount = (node: React.ReactElement) => {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const stderr = new PassThrough()
  let output = ''

  Object.assign(stdout, { columns: 80, isTTY: false, rows: 20 })
  Object.assign(stdin, { isTTY: false })
  Object.assign(stderr, { isTTY: false })
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  const instance = renderSync(node, {
    patchConsole: false,
    stderr: stderr as NodeJS.WriteStream,
    stdin: stdin as NodeJS.ReadStream,
    stdout: stdout as NodeJS.WriteStream
  })

  // Repaints accumulate in the stream: read the frame from the line holding
  // the last panel header.
  const lastFrame = () => {
    const plain = stripAnsi(output)

    return plain.slice(plain.lastIndexOf('\n', plain.lastIndexOf('Tool calls')) + 1)
  }

  const done = () => {
    instance.unmount()
    instance.cleanup()
  }

  return { done, instance, lastFrame }
}

describe('ToolTrail — display.tools_recent window', () => {
  it('shows only the rows inside the window and folds the earlier ones', async () => {
    const { done, lastFrame } = mount(trail(2))

    await flushEffects()

    const frame = lastFrame()

    expect(frame).toContain('Tool calls (4)')
    expect(frame).toContain('Gamma')
    expect(frame).toContain('Delta')
    expect(frame).not.toContain('Alpha')
    expect(frame).not.toContain('Beta')
    expect(frame).toContain('2 earlier')
    done()
  })

  it('keeps a panel outside the window closed', async () => {
    const { done, lastFrame } = mount(trail(0))

    await flushEffects()

    expect(lastFrame()).toContain('▸ Tool calls (4)')
    expect(lastFrame()).not.toContain('Delta')
    done()
  })

  it('folds a panel once newer tool calls push it out of the window', async () => {
    const { done, instance, lastFrame } = mount(trail(4))

    await flushEffects()
    expect(lastFrame()).toContain('Alpha')

    instance.rerender(trail(0))
    await flushEffects()

    expect(lastFrame()).toContain('▸ Tool calls (4)')
    expect(lastFrame()).not.toContain('Alpha')
    done()
  })

  it('leaves the plain collapsed behaviour alone when the window is off', async () => {
    const { done, lastFrame } = mount(trail(undefined))

    await flushEffects()

    expect(lastFrame()).toContain('▸ Tool calls (4)')
    expect(lastFrame()).not.toContain('Delta')
    done()
  })

  it('reaches a settled transcript trail through MessageLine', async () => {
    const { done, lastFrame } = mount(
      <MessageLine
        cols={80}
        msg={{ kind: 'trail', role: 'system', text: '', tools: TRAIL }}
        recentTools={1}
        sections={{ tools: 'collapsed' }}
        t={DEFAULT_THEME}
      />
    )

    await flushEffects()

    expect(lastFrame()).toContain('Delta')
    expect(lastFrame()).not.toContain('Gamma')
    expect(lastFrame()).toContain('3 earlier')
    done()
  })
})
