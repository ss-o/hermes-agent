import { beforeEach, describe, expect, it } from 'vitest'

import { $uiState, resetUiState } from '../app/uiStore.js'
import { applyDisplay } from '../app/useConfigSync.js'
import { liveToolTotal } from '../components/streamingAssistant.js'
import {
  msgToolGroups,
  parseToolsRecent,
  recentToolBudgets,
  toolGroupCount,
  toolsPanelView
} from '../domain/recentTools.js'

describe('toolGroupCount', () => {
  it('counts finished and drafting tool rows, not ambient trail lines', () => {
    const trail = [
      'Terminal("ls") ✓',
      'Read File("a.ts") :: 12 lines ✓',
      'Patch("b.ts") ✗',
      'analyzing tool output…',
      'drafting web_search…',
      'gateway reconnected'
    ]

    expect(toolGroupCount(trail)).toBe(4)
  })

  it('adds tools still running', () => {
    expect(toolGroupCount(['Terminal("ls") ✓'], 2)).toBe(3)
    expect(toolGroupCount(undefined, 1)).toBe(1)
  })
})

describe('msgToolGroups', () => {
  it('counts tool rows on trail and assistant messages only', () => {
    expect(msgToolGroups({ kind: 'trail', role: 'system', text: '', tools: ['A ✓', 'B ✓'] })).toBe(2)
    expect(msgToolGroups({ role: 'assistant', text: 'done', tools: ['A ✓'] })).toBe(1)
    expect(msgToolGroups({ role: 'user', text: 'hi' })).toBe(0)
    expect(msgToolGroups({ role: 'tool', text: 'output' })).toBe(0)
  })

  it('ignores todo trails, which render as a todo panel', () => {
    expect(
      msgToolGroups({
        kind: 'trail',
        role: 'system',
        text: '',
        todos: [{ content: 'x', id: '1', status: 'pending' }],
        tools: ['A ✓']
      })
    ).toBe(0)
  })
})

describe('recentToolBudgets', () => {
  it('gives the newest blocks the visible rows, oldest first in the result', () => {
    expect(recentToolBudgets([3, 0, 4, 2], 5)).toEqual([0, 0, 3, 2])
  })

  it('shows everything when the session has fewer calls than the limit', () => {
    expect(recentToolBudgets([1, 2], 5)).toEqual([1, 2])
  })

  it('shows nothing when the limit is used up', () => {
    expect(recentToolBudgets([2, 2], 0)).toEqual([0, 0])
  })
})

describe('toolsPanelView', () => {
  it('opens a panel inside the window and folds the rows before it', () => {
    expect(toolsPanelView(6, 2, null)).toEqual({ hidden: 4, open: true })
    expect(toolsPanelView(2, 2, null)).toEqual({ hidden: 0, open: true })
  })

  it('closes a panel outside the window', () => {
    expect(toolsPanelView(3, 0, null)).toEqual({ hidden: 0, open: false })
  })

  it('lets a manual choice win over the window and show every row', () => {
    expect(toolsPanelView(6, 2, false)).toEqual({ hidden: 0, open: false })
    expect(toolsPanelView(6, 0, true)).toEqual({ hidden: 0, open: true })
  })
})

describe('liveToolTotal', () => {
  const live = {
    streamPendingTools: ['drafting web_search…'],
    streamSegments: [{ kind: 'trail' as const, role: 'system' as const, text: '', tools: ['A ✓', 'B ✓'] }],
    streaming: '',
    tools: [{ id: 't1', name: 'terminal' }]
  }

  it('counts settled segments, running tools and pending drafts in the live area', () => {
    expect(liveToolTotal(live, true)).toBe(4)
  })

  it('counts nothing while the live area is not drawn', () => {
    expect(liveToolTotal({ ...live, tools: [] }, false)).toBe(0)
  })
})

describe('applyDisplay → tools_recent', () => {
  beforeEach(() => {
    resetUiState()
  })

  it('reads display.tools_recent and falls back to 5 when it is unset', () => {
    applyDisplay({ config: { display: { tools_recent: 2 } } }, () => {})
    expect($uiState.get().toolsRecent).toBe(2)

    applyDisplay({ config: { display: {} } }, () => {})
    expect($uiState.get().toolsRecent).toBe(5)
  })
})

describe('parseToolsRecent', () => {
  it('defaults to 5 when unset or invalid', () => {
    expect(parseToolsRecent(undefined)).toBe(5)
    expect(parseToolsRecent('lots')).toBe(5)
    expect(parseToolsRecent(-1)).toBe(5)
    expect(parseToolsRecent(2.5)).toBe(5)
  })

  it('accepts a non-negative integer, with 0 turning the window off', () => {
    expect(parseToolsRecent(0)).toBe(0)
    expect(parseToolsRecent(8)).toBe(8)
    expect(parseToolsRecent('3')).toBe(3)
  })
})
