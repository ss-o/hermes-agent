import { parseToolTrailResultLine } from '../lib/text.js'
import type { Msg } from '../types.js'

// `display.tools_recent`: while the tools section is collapsed, the newest N
// tool rows of the session stay open and every older row folds. Counting
// happens here, outside the renderer, so the transcript and the live area
// agree on where the window starts.

export const DEFAULT_TOOLS_RECENT = 5

/** A trail line that `ToolTrail` draws as its own tool row. */
export const isToolGroupLine = (line: string) => line.startsWith('drafting ') || parseToolTrailResultLine(line) !== null

export const toolGroupCount = (trail: readonly string[] = [], liveTools = 0): number =>
  trail.filter(isToolGroupLine).length + liveTools

/** Tool rows a settled transcript message renders: trail and assistant rows carry them. */
export const msgToolGroups = (msg: Msg): number => {
  if (msg.kind === 'trail' && msg.todos?.length) {
    return 0
  }

  return msg.kind === 'trail' || msg.role === 'assistant' ? toolGroupCount(msg.tools) : 0
}

/** Per block (oldest first), how many of its newest rows fall inside the last `limit` rows. */
export const recentToolBudgets = (counts: readonly number[], limit: number): number[] => {
  let left = Math.max(0, limit)
  const budgets = new Array<number>(counts.length).fill(0)

  for (let i = counts.length - 1; i >= 0 && left > 0; i--) {
    budgets[i] = Math.min(counts[i]!, left)
    left -= budgets[i]!
  }

  return budgets
}

export interface ToolsPanelView {
  hidden: number
  open: boolean
}

/** `manual` is the user's own chevron choice (null until they click); it wins and shows every row. */
export const toolsPanelView = (total: number, recent: number, manual: boolean | null): ToolsPanelView => {
  if (manual !== null) {
    return { hidden: 0, open: manual }
  }

  return recent > 0 ? { hidden: Math.max(0, total - recent), open: true } : { hidden: 0, open: false }
}

export const parseToolsRecent = (raw: unknown): number => {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw

  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : DEFAULT_TOOLS_RECENT
}
