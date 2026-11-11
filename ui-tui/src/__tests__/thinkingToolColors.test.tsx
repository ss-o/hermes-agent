import { PassThrough } from 'stream'

import { renderSync } from '@hermes/ink'
import chalk from 'chalk'
import React from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ToolTrail } from '../components/thinking.js'
import { splitToolCall } from '../lib/text.js'
import { DEFAULT_THEME, type Theme } from '../theme.js'

// Distinct, known colours so each role's SGR is unambiguous in the output.
const T: Theme = {
  ...DEFAULT_THEME,
  color: {
    ...DEFAULT_THEME.color,
    accent: '#ff00ff',
    error: '#ff0000',
    label: '#0000ff',
    muted: '#808080',
    ok: '#00ff00',
    text: '#ffffff',
    tool: '#ffff00'
  }
}

const sgr = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

  return `38;2;${r};${g};${b}`
}

const flushEffects = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const render = async (node: React.ReactElement) => {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const stderr = new PassThrough()
  let output = ''

  Object.assign(stdout, { columns: 100, isTTY: false, rows: 20 })
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

  await flushEffects()
  instance.unmount()
  instance.cleanup()

  return output
}

// The SGR parameters in force where `text` last starts in the raw output.
const styleAt = (output: string, text: string) => {
  const at = output.lastIndexOf(text)

  expect(at, `${text} not rendered`).toBeGreaterThanOrEqual(0)

  return styleBefore(output, at)
}

// The foreground and faint state in force at `at`, replaying every SGR before it.
const styleBefore = (output: string, at: number) => {
  let fg = ''
  let dim = false

  // eslint-disable-next-line no-control-regex
  for (const m of output.slice(0, at).matchAll(/\x1b\[([\d;]*)m/g)) {
    const codes = (m[1] || '0').split(';')

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]

      if (code === '0') {
        fg = ''
        dim = false
      } else if (code === '2') {
        dim = true
      } else if (code === '22') {
        dim = false
      } else if (code === '39') {
        fg = ''
      } else if (code === '38' && codes[i + 1] === '2') {
        fg = `38;2;${codes[i + 2]};${codes[i + 3]};${codes[i + 4]}`
        i += 4
      }
    }
  }

  return { dim, fg }
}

// The style of the row marker drawn on the same row as `label`.
const markerStyle = (output: string, label: string) =>
  styleBefore(output, output.lastIndexOf('●', output.lastIndexOf(label)))

const lastFg = (style: { fg: string }) => style.fg
const isDim = (style: { dim: boolean }) => style.dim

let level: typeof chalk.level

beforeAll(() => {
  level = chalk.level
  chalk.level = 3
})

afterAll(() => {
  chalk.level = level
})

const trail = ['ReadFile("a.ts") :: twelve lines ✓', 'PatchFile("b.ts") :: no match ✗']

describe('ToolTrail — tool row colour roles', () => {
  it('colours the tool name as a label and its arguments as muted', async () => {
    const out = await render(<ToolTrail sections={{ tools: 'expanded' }} t={T} trail={trail} />)

    expect(lastFg(styleAt(out, 'ReadFile'))).toBe(sgr('#0000ff'))
    expect(lastFg(styleAt(out, '("a.ts")'))).toBe(sgr('#808080'))
  })

  it('colours the row marker by outcome', async () => {
    const out = await render(<ToolTrail sections={{ tools: 'expanded' }} t={T} trail={trail} />)

    expect(lastFg(markerStyle(out, 'ReadFile'))).toBe(sgr('#00ff00'))
    expect(lastFg(markerStyle(out, 'PatchFile'))).toBe(sgr('#ff0000'))
  })

  it('keeps a failed call and its message in the error colour', async () => {
    const out = await render(<ToolTrail sections={{ tools: 'expanded' }} t={T} trail={trail} />)

    expect(lastFg(styleAt(out, 'PatchFile'))).toBe(sgr('#ff0000'))
    expect(lastFg(styleAt(out, 'no match'))).toBe(sgr('#ff0000'))
  })

  it('shows result previews muted without the faint attribute', async () => {
    const out = await render(<ToolTrail sections={{ tools: 'expanded' }} t={T} trail={trail} />)
    const style = styleAt(out, 'twelve lines')

    expect(lastFg(style)).toBe(sgr('#808080'))
    expect(isDim(style)).toBe(false)
  })

  it('draws panel headers muted without faint, with the count in the accent colour', async () => {
    const out = await render(<ToolTrail sections={{ tools: 'expanded' }} t={T} trail={trail} />)
    const title = styleAt(out, 'Tool calls')

    expect(lastFg(title)).toBe(sgr('#808080'))
    expect(isDim(title)).toBe(false)
    expect(lastFg(styleAt(out, '(2)'))).toBe(sgr('#ff00ff'))
  })

  it('styles a running call the same way, with the marker in the tool colour', async () => {
    const out = await render(
      <ToolTrail sections={{ tools: 'expanded' }} t={T} tools={[{ context: 'a.ts', id: 't1', name: 'read_file' }]} />
    )

    expect(lastFg(styleAt(out, 'Read File'))).toBe(sgr('#0000ff'))
    expect(lastFg(markerStyle(out, 'Read File'))).toBe(sgr('#ffff00'))
  })
})

describe('splitToolCall', () => {
  it('splits a call into its name and arguments', () => {
    expect(splitToolCall('Terminal("ls -la")')).toEqual({ args: '("ls -la")', name: 'Terminal' })
    expect(splitToolCall('📖 Read  a.ts +2')).toEqual({ args: '  a.ts +2', name: '📖 Read' })
    expect(splitToolCall('📖 Read  fn(x)')).toEqual({ args: '  fn(x)', name: '📖 Read' })
    expect(splitToolCall('Search("a  b")')).toEqual({ args: '("a  b")', name: 'Search' })
    expect(splitToolCall('Open(half')).toEqual({ args: '', name: 'Open(half' })
    expect(splitToolCall('Todo')).toEqual({ args: '', name: 'Todo' })
  })
})
