import { stringWidth } from '@hermes/ink'
import { describe, expect, it } from 'vitest'

import { busyIndicatorWidth } from '../components/appChrome.js'

describe('actual activity width', () => {
  it('budgets the displayed tool name even for the unicode indicator', () => {
    expect(busyIndicatorWidth('unicode', false, 'terminal')).toBe(stringWidth('⠋ terminal'))
  })

  it('bounds long tool names so they cannot consume the model slot', () => {
    expect(busyIndicatorWidth('unicode', false, 'x'.repeat(1000))).toBe(stringWidth('⠋ ' + 'x'.repeat(24)))
  })
})
