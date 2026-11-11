import { describe, expect, it, vi } from 'vitest'

import { handleMouseEvent } from './components/App.js'
import { createSelectionState, hasSelection, startSelection, updateSelection } from './selection.js'

const makeApp = () => {
  const selection = createSelectionState()

  return {
    clickCount: 1,
    lastHoverCol: -1,
    lastHoverRow: -1,
    mouseCaptureTarget: undefined,
    props: {
      getSelectedText: vi.fn(() => 'selected text'),
      onCopySelectionNoClear: vi.fn(async () => 'selected text'),
      onHoverAt: vi.fn(),
      onMouseDownAt: vi.fn(),
      onMouseDragAt: vi.fn(),
      onMouseUpAt: vi.fn(),
      onSelectionDrag: vi.fn(),
      onSelectionChange: vi.fn(),
      selection
    }
  } as any
}

describe('handleMouseEvent right-click selection behavior', () => {
  it('copies an active selection instead of dispatching right-click paste handlers', async () => {
    const app = makeApp()

    startSelection(app.props.selection, 0, 0)
    updateSelection(app.props.selection, 4, 0)

    handleMouseEvent(app, { action: 'press', button: 2, col: 3, kind: 'mouse', row: 1 })
    await Promise.resolve()

    expect(app.props.onCopySelectionNoClear).toHaveBeenCalledOnce()
    expect(app.props.onMouseDownAt).not.toHaveBeenCalled()
    expect(app.clickCount).toBe(0)
  })

  it('clears the highlight after a successful right-click copy', async () => {
    const app = makeApp()

    startSelection(app.props.selection, 0, 0)
    updateSelection(app.props.selection, 4, 0)
    expect(hasSelection(app.props.selection)).toBe(true)

    handleMouseEvent(app, { action: 'press', button: 2, col: 3, kind: 'mouse', row: 1, sequence: '' })
    await Promise.resolve()
    await Promise.resolve()

    // Deliberate copy clears the selection (visual confirmation + a follow-up
    // right-click on empty space pastes rather than re-copying a stale range).
    expect(hasSelection(app.props.selection)).toBe(false)
    expect(app.props.onSelectionChange).toHaveBeenCalled()
  })

  it('keeps the highlight when right-click copy fails (no clipboard path)', async () => {
    const app = makeApp()
    app.props.onCopySelectionNoClear.mockResolvedValue('')

    startSelection(app.props.selection, 0, 0)
    updateSelection(app.props.selection, 4, 0)

    handleMouseEvent(app, { action: 'press', button: 2, col: 3, kind: 'mouse', row: 1, sequence: '' })
    await Promise.resolve()
    await Promise.resolve()

    // Copy didn't land, so the highlight must survive (and we fall back to the
    // right-click paste handler instead).
    expect(hasSelection(app.props.selection)).toBe(true)
  })

  it('falls back to right-click handlers when selection copy has no clipboard path', async () => {
    const app = makeApp()
    app.props.onCopySelectionNoClear.mockResolvedValue('')

    startSelection(app.props.selection, 0, 0)
    updateSelection(app.props.selection, 4, 0)

    handleMouseEvent(app, { action: 'press', button: 2, col: 3, kind: 'mouse', row: 1 })
    await Promise.resolve()

    expect(app.props.onCopySelectionNoClear).toHaveBeenCalledOnce()
    expect(app.props.onMouseDownAt).toHaveBeenCalledWith(2, 0, 2)
  })

  it('does not paste when highlighted selection text is empty', async () => {
    const app = makeApp()
    app.props.getSelectedText.mockReturnValue('')

    startSelection(app.props.selection, 0, 0)
    updateSelection(app.props.selection, 4, 0)

    handleMouseEvent(app, { action: 'press', button: 2, col: 3, kind: 'mouse', row: 1 })
    await Promise.resolve()

    expect(app.props.onCopySelectionNoClear).not.toHaveBeenCalled()
    expect(app.props.onMouseDownAt).not.toHaveBeenCalled()
  })

  it.each([false, true])('does not copy or paste during right-button motion with selection=%s', (selected: boolean) => {
    const app = makeApp()

    if (selected) {
      startSelection(app.props.selection, 0, 0)
      updateSelection(app.props.selection, 4, 0)
    }

    handleMouseEvent(app, {
      action: 'press',
      button: 0x20 | 2,
      col: 3,
      kind: 'mouse',
      row: 1,
      sequence: '\x1b[<34;3;1M'
    })

    expect(app.props.onCopySelectionNoClear).not.toHaveBeenCalled()
    expect(app.props.onMouseDownAt).not.toHaveBeenCalled()

    handleMouseEvent(app, { action: 'press', button: 2, col: 3, kind: 'mouse', row: 1, sequence: '\x1b[<2;3;1M' })

    if (selected) {
      expect(app.props.onCopySelectionNoClear).toHaveBeenCalledOnce()
    } else {
      expect(app.props.onMouseDownAt).toHaveBeenCalledExactlyOnceWith(2, 0, 2)
    }
  })

  it('still dispatches right-click handlers when no text is selected', () => {
    const app = makeApp()

    handleMouseEvent(app, { action: 'press', button: 2, col: 3, kind: 'mouse', row: 1 })

    expect(app.props.onCopySelectionNoClear).not.toHaveBeenCalled()
    expect(app.props.onMouseDownAt).toHaveBeenCalledWith(2, 0, 2)
  })

  it('does not turn middle-button motion into a fresh middle click', () => {
    const app = makeApp()

    handleMouseEvent(app, {
      action: 'press',
      button: 0x20 | 1,
      col: 3,
      kind: 'mouse',
      row: 1,
      sequence: '\x1b[<33;3;1M'
    })

    expect(app.props.onMouseDownAt).not.toHaveBeenCalled()

    handleMouseEvent(app, { action: 'press', button: 1, col: 3, kind: 'mouse', row: 1, sequence: '\x1b[<1;3;1M' })

    expect(app.props.onMouseDownAt).toHaveBeenCalledExactlyOnceWith(2, 0, 1)
  })

  it('keeps no-button motion on the hover path', () => {
    const app = makeApp()

    handleMouseEvent(app, {
      action: 'press',
      button: 0x20 | 3,
      col: 3,
      kind: 'mouse',
      row: 1,
      sequence: '\x1b[<35;3;1M'
    })

    expect(app.props.onHoverAt).toHaveBeenCalledExactlyOnceWith(2, 0)
    expect(app.props.onMouseDownAt).not.toHaveBeenCalled()
    expect(app.props.onCopySelectionNoClear).not.toHaveBeenCalled()
  })

  it('preserves captured left-button drag and release', () => {
    const app = makeApp()
    const target = {}
    app.props.onMouseDownAt.mockReturnValue(target)

    handleMouseEvent(app, { action: 'press', button: 0, col: 3, kind: 'mouse', row: 1, sequence: '\x1b[<0;3;1M' })
    handleMouseEvent(app, { action: 'press', button: 0x20, col: 7, kind: 'mouse', row: 1, sequence: '\x1b[<32;7;1M' })
    handleMouseEvent(app, { action: 'release', button: 0, col: 7, kind: 'mouse', row: 1, sequence: '\x1b[<0;7;1m' })

    expect(app.props.onMouseDownAt).toHaveBeenCalledExactlyOnceWith(2, 0, 0)
    expect(app.props.onMouseDragAt).toHaveBeenCalledExactlyOnceWith(target, 6, 0, 0)
    expect(app.props.onMouseUpAt).toHaveBeenCalledExactlyOnceWith(target, 6, 0, 0)
    expect(app.mouseCaptureTarget).toBeUndefined()
  })

  it('preserves left-button transcript selection', () => {
    const app = makeApp()
    app.props.onSelectionDrag.mockImplementation((col: number, row: number) =>
      updateSelection(app.props.selection, col, row)
    )

    handleMouseEvent(app, { action: 'press', button: 0, col: 3, kind: 'mouse', row: 1, sequence: '\x1b[<0;3;1M' })
    handleMouseEvent(app, { action: 'press', button: 0x20, col: 7, kind: 'mouse', row: 1, sequence: '\x1b[<32;7;1M' })
    handleMouseEvent(app, { action: 'release', button: 0, col: 7, kind: 'mouse', row: 1, sequence: '\x1b[<0;7;1m' })

    expect(app.props.onSelectionDrag).toHaveBeenCalledExactlyOnceWith(6, 0)
    expect(hasSelection(app.props.selection)).toBe(true)
    expect(app.props.selection.isDragging).toBe(false)
  })
})
