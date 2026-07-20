// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DiscoveredEntity } from '../../src/shared/domain'
import { ResourceExplorerList } from '../../src/renderer/src/components/ResourceExplorerList'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 320 })
  HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 900, height: 320, top: 0, right: 900, bottom: 320, left: 0, toJSON: () => ({})
  })
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this)
    }
    disconnect(): void {}
    unobserve(): void {}
  }
})

describe('ResourceExplorerList', () => {
  it('virtualizes thousands of resources and activates the searched result with the keyboard', async () => {
    const onActivate = vi.fn()
    const entities = Array.from({ length: 2_000 }, (_, index): DiscoveredEntity => ({
      key: `queue:orders-${index}`,
      name: `orders-${index}`,
      kind: 'queue',
      parent: null,
      messageCount: index,
      childCount: null,
      canInspect: true,
      canTarget: true,
      suggestedSource: false
    }))
    const user = userEvent.setup()
    const { container } = render(createElement(ResourceExplorerList, {
      id: 'large-list', entities, onActivate
    }))

    await waitFor(() => expect(container.querySelectorAll('.resource-list-row').length).toBeGreaterThan(0))
    expect(container.querySelectorAll('.resource-list-row').length).toBeLessThan(40)

    const search = screen.getByRole('combobox', { name: 'Buscar recursos' })
    await user.type(search, 'orders-1842')
    expect(screen.getByText('1 de 2000')).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ name: 'orders-1842' }))
  })
})
