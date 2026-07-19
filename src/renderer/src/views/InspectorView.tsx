import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type RowSelectionState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, ArrowLeft, Braces, CheckCircle2, ChevronRight, FileJson2, Filter, LockKeyhole, Play, RefreshCw, X } from 'lucide-react'
import type { ConnectionProfile, NormalizedMessage, OperationJob, SourceSummary } from '@shared/domain'
import { formatDate, readableError, invoke } from '../lib/api'

interface InspectorViewProps {
  source: SourceSummary
  profile: ConnectionProfile
  activeJob: OperationJob | null
  onBack: () => void
}

const columnHelper = createColumnHelper<NormalizedMessage>()

export function InspectorView({ source, profile, activeJob, onBack }: InspectorViewProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [selectedMessage, setSelectedMessage] = useState<NormalizedMessage | null>(null)
  const [detailTab, setDetailTab] = useState<'payload' | 'headers' | 'metadata'>('payload')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [throttle, setThrottle] = useState(5)
  const parentRef = useRef<HTMLDivElement>(null)

  const messagesQuery = useQuery({
    queryKey: ['messages', profile.id, source.id],
    queryFn: () => invoke('listMessages', { profileId: profile.id, sourceId: source.id, limit: 250 })
  })
  const filteredMessages = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return messagesQuery.data?.items ?? []
    return (messagesQuery.data?.items ?? []).filter((message) =>
      [message.id, message.deadLetterReason, message.bodyText, message.headers].some((value) =>
        JSON.stringify(value).toLowerCase().includes(query)
      )
    )
  }, [filter, messagesQuery.data])

  const columns = useMemo(() => [
    columnHelper.display({
      id: 'select',
      size: 44,
      header: ({ table }) => <input aria-label="Seleccionar todos los mensajes visibles" type="checkbox" checked={table.getIsAllRowsSelected()} ref={(input) => { if (input) input.indeterminate = table.getIsSomeRowsSelected() }} onChange={table.getToggleAllRowsSelectedHandler()} />,
      cell: ({ row }) => <input aria-label={`Seleccionar mensaje ${row.original.id}`} type="checkbox" checked={row.getIsSelected()} disabled={!row.getCanSelect()} onChange={row.getToggleSelectedHandler()} onClick={(event) => event.stopPropagation()} />
    }),
    columnHelper.accessor('id', { header: 'Message ID', size: 220, cell: (info) => <code>{info.getValue()}</code> }),
    columnHelper.accessor('deadLetterReason', { header: 'Causa', size: 180, cell: (info) => <span className="reason-label">{info.getValue() ?? 'Sin causa'}</span> }),
    columnHelper.accessor('deliveryCount', { header: 'Intentos', size: 90, cell: (info) => <span className="numeric">{info.getValue()}</span> }),
    columnHelper.accessor('enqueuedAt', { header: 'Encolado', size: 180, cell: (info) => formatDate(info.getValue()) }),
    columnHelper.accessor('sizeBytes', { header: 'Tamaño', size: 90, cell: (info) => `${info.getValue().toLocaleString('es-CR')} B` }),
    columnHelper.display({ id: 'open', size: 44, cell: () => <ChevronRight size={16} aria-hidden="true" /> })
  ], [])

  const table = useReactTable({
    data: filteredMessages,
    columns,
    state: {
      rowSelection,
      columnVisibility: selectedMessage ? { sizeBytes: false, open: false } : {}
    },
    getRowId: (message) => message.id,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true
  })
  const rows = table.getRowModel().rows
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 48, overscan: 8 })
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (confirmOpen) setConfirmOpen(false)
      else if (selectedMessage) setSelectedMessage(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [confirmOpen, selectedMessage])

  const requeueMutation = useMutation({
    mutationFn: () => invoke('startRequeue', {
      profileId: profile.id,
      sourceId: source.id,
      targetName: source.targetName ?? '',
      messageIds: selectedIds,
      throttlePerSecond: throttle
    }),
    onSuccess: async () => {
      setConfirmOpen(false)
      setRowSelection({})
      await queryClient.invalidateQueries({ queryKey: ['jobs'] })
    }
  })

  const isCurrentJob = activeJob?.profileId === profile.id && activeJob.sourceId === source.id
  const progress = isCurrentJob && activeJob.total > 0 ? Math.round((activeJob.processed / activeJob.total) * 100) : 0

  return (
    <section className="view inspector-view" aria-labelledby="inspector-title">
      <header className="view-header compact">
        <div className="title-with-back"><button className="icon-button" onClick={onBack} aria-label="Volver al dashboard" title="Volver al dashboard"><ArrowLeft size={18} /></button><div><p className="context-label">{profile.name}</p><h1 id="inspector-title">{source.displayName}</h1></div></div>
        <div className="header-actions">
          {profile.readOnly ? <span className="read-only-label"><LockKeyhole size={14} />Solo lectura</span> : null}
          <button className="button button-secondary" onClick={() => void messagesQuery.refetch()} disabled={messagesQuery.isFetching}><RefreshCw size={16} className={messagesQuery.isFetching ? 'spin' : ''} />Actualizar</button>
          <button className="button button-primary" disabled={selectedIds.length === 0 || profile.readOnly || !source.targetName || isCurrentJob && (activeJob.status === 'running' || activeJob.status === 'queued')} onClick={() => setConfirmOpen(true)}><Play size={16} />Requeue {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}</button>
        </div>
      </header>

      {messagesQuery.data?.warning ? <div className="notice notice-warning"><AlertCircle size={18} /><span>{messagesQuery.data.warning}</span></div> : null}
      {messagesQuery.error ? <div className="notice notice-error" role="alert"><AlertCircle size={18} /><span>{readableError(messagesQuery.error)}</span></div> : null}
      {profile.readOnly && selectedIds.length > 0 ? <div className="notice notice-neutral"><LockKeyhole size={18} /><span>El perfil está en solo lectura. La selección se conserva, pero requeue permanece bloqueado.</span></div> : null}

      {isCurrentJob ? <div className={`job-progress job-${activeJob.status}`} aria-live="polite"><div><span>{activeJob.status === 'running' ? 'Requeue en curso' : activeJob.status === 'completed' ? 'Requeue completado' : activeJob.status === 'cancelled' ? 'Operación cancelada' : activeJob.status === 'failed' ? 'Operación fallida' : 'Preparando operación'}</span><strong>{activeJob.processed} / {activeJob.total}</strong></div><div className="progress-track"><span style={{ transform: `scaleX(${progress / 100})` }} /></div>{activeJob.error ? <small>{activeJob.error}</small> : null}</div> : null}

      <div className="inspector-toolbar">
        <label className="search-field"><Filter size={16} /><span className="sr-only">Filtrar mensajes</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar por ID, causa, header o payload" /></label>
        <span>{filteredMessages.length} mensajes visibles</span>
      </div>

      <div className={`inspector-layout ${selectedMessage ? 'with-detail' : ''}`}>
        <div className="virtual-table" role="grid" aria-label="Mensajes de la dead-letter queue">
          <div className="virtual-header" role="row">
            {table.getHeaderGroups()[0]?.headers.map((header) => <div role="columnheader" key={header.id} style={{ width: header.getSize(), flex: `${header.getSize()} 0 auto` }}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</div>)}
          </div>
          <div className="virtual-scroll" ref={parentRef}>
            {messagesQuery.isLoading ? <div className="message-skeleton" aria-label="Consultando mensajes" aria-busy="true">{Array.from({ length: 7 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton skeleton-check" /><span className="skeleton skeleton-wide" /><span className="skeleton" /><span className="skeleton skeleton-short" /></div>)}</div> : rows.length === 0 ? <div className="empty-state compact"><FileJson2 size={26} /><h3>No hay mensajes que coincidan</h3><p>{filter ? 'Prueba con un filtro menos específico.' : 'La fuente no contiene mensajes visibles.'}</p></div> : <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index]
                if (!row) return null
                return <div className={`virtual-row ${selectedMessage?.id === row.original.id ? 'active' : ''}`} role="row" key={row.id} onClick={() => setSelectedMessage(row.original)} style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}>{row.getVisibleCells().map((cell) => <div role="gridcell" key={cell.id} style={{ width: cell.column.getSize(), flex: `${cell.column.getSize()} 0 auto` }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>)}</div>
              })}
            </div>}
          </div>
        </div>

        {selectedMessage ? <aside className="message-detail" aria-label="Detalle del mensaje">
          <header><div><span>Detalle del mensaje</span><code>{selectedMessage.id}</code></div><button className="icon-button" aria-label="Cerrar detalle" onClick={() => setSelectedMessage(null)}><X size={17} /></button></header>
          <div className="detail-tabs" role="tablist"><button role="tab" aria-selected={detailTab === 'payload'} className={detailTab === 'payload' ? 'active' : ''} onClick={() => setDetailTab('payload')}>Payload</button><button role="tab" aria-selected={detailTab === 'headers'} className={detailTab === 'headers' ? 'active' : ''} onClick={() => setDetailTab('headers')}>Headers</button><button role="tab" aria-selected={detailTab === 'metadata'} className={detailTab === 'metadata' ? 'active' : ''} onClick={() => setDetailTab('metadata')}>Metadata</button></div>
          <div className="detail-content">{detailTab === 'payload' ? <pre>{selectedMessage.bodyText}</pre> : detailTab === 'headers' ? <pre>{JSON.stringify(selectedMessage.headers, null, 2)}</pre> : <dl><dt>Causa</dt><dd>{selectedMessage.deadLetterReason ?? 'Sin datos'}</dd><dt>Descripción</dt><dd>{selectedMessage.deadLetterDescription ?? 'Sin datos'}</dd><dt>Intentos</dt><dd>{selectedMessage.deliveryCount}</dd><dt>Content-Type</dt><dd>{selectedMessage.contentType ?? 'Sin datos'}</dd><dt>Hash SHA-256</dt><dd><code>{selectedMessage.rawHash}</code></dd><dt>Encolado</dt><dd>{formatDate(selectedMessage.enqueuedAt)}</dd></dl>}</div>
        </aside> : null}
      </div>

      {confirmOpen ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !requeueMutation.isPending) setConfirmOpen(false) }}><section className="modal modal-small" role="alertdialog" aria-modal="true" aria-labelledby="requeue-title"><header className="modal-header"><div className="dialog-icon"><Braces size={20} /></div><div><h2 id="requeue-title">Reenviar {selectedIds.length} mensajes</h2><p className="modal-subtitle">La operación se registrará en la auditoría local.</p></div><button className="icon-button" aria-label="Cerrar" onClick={() => setConfirmOpen(false)} disabled={requeueMutation.isPending}><X size={18} /></button></header><div className="confirm-summary"><div><span>Origen</span><strong>{source.displayName}</strong></div><div><span>Destino</span><strong>{source.targetName}</strong></div><div><span>Perfil</span><strong>{profile.name}</strong></div></div><label className="field"><span>Máximo por segundo</span><input type="number" min="0.2" max="100" step="0.2" value={throttle} onChange={(event) => setThrottle(Number(event.target.value))} /></label>{requeueMutation.error ? <div className="field-error" role="alert">{readableError(requeueMutation.error)}</div> : null}<footer className="modal-actions"><button className="button button-secondary" onClick={() => setConfirmOpen(false)} disabled={requeueMutation.isPending}>Cancelar</button><button className="button button-primary" onClick={() => requeueMutation.mutate()} disabled={requeueMutation.isPending}><CheckCircle2 size={16} />{requeueMutation.isPending ? 'Iniciando...' : 'Confirmar requeue'}</button></footer></section></div> : null}
    </section>
  )
}
