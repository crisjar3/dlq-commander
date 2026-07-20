// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { emptyResourceMetrics, type DiscoveredEntity } from '../../src/shared/domain'
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
      suggestedSource: false,
      status: null,
      metrics: { ...emptyResourceMetrics(), totalMessages: index }
    }))
    const user = userEvent.setup()
    const { container } = render(createElement(ResourceExplorerList, {
      id: 'large-list', entities, onActivate
    }))

    await waitFor(() => expect(container.querySelectorAll('.resource-list-row').length).toBeGreaterThan(0))
    expect(container.querySelectorAll('.resource-list-row').length).toBeLessThan(40)

    const search = screen.getByRole('combobox', { name: 'Buscar recursos' })
    await user.type(search, 'orders-1842')
    expect(screen.getByText(/1 coincidencia en/)).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ name: 'orders-1842' }))
  })

  it('paginates the visible result set in pages of 50 with keyboard and icon controls', async () => {
    const onActivate = vi.fn()
    const entities = Array.from({ length: 125 }, (_, index): DiscoveredEntity => ({
      key: `queue:queue-${String(index).padStart(3, '0')}`,
      name: `queue-${String(index).padStart(3, '0')}`,
      kind: 'queue', parent: null, messageCount: index, childCount: null,
      canInspect: true, canTarget: true, suggestedSource: false, status: 'running',
      metrics: { ...emptyResourceMetrics(), totalMessages: index }
    }))
    const user = userEvent.setup()
    const { container } = render(createElement(ResourceExplorerList, { id: 'paged-list', entities, brokerType: 'rabbitmq', onActivate }))
    const view = within(container)
    const search = view.getByRole('combobox', { name: 'Buscar recursos' })
    expect(view.getByText('Página 1 de 3')).toBeTruthy()
    expect(container.querySelectorAll('.resource-list-row').length).toBeLessThan(50)
    await user.click(search)
    await user.keyboard('{PageDown}')
    expect(view.getByText('Página 2 de 3')).toBeTruthy()
    await user.click(view.getByRole('button', { name: 'Última página' }))
    expect(view.getByText('Página 3 de 3')).toBeTruthy()
    await user.type(search, 'queue-084')
    expect(view.getByText('Página 1 de 1')).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ name: 'queue-084' }))
  })
})
