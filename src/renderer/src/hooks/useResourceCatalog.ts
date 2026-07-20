import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { DiscoveredEntity, ResourceCollection } from '@shared/domain'
import { invoke } from '../lib/api'

export interface ResourceCatalog {
  entities: DiscoveredEntity[]
  loadedCount: number
  totalCount: number | null
  latencyMs: number
  isInitialLoading: boolean
  isLoadingMore: boolean
  isComplete: boolean
  error: Error | null
  retry(): void
  refresh(): void
}

export function useResourceCatalog(
  profileId: string,
  collection: ResourceCollection,
  enabled = true
): ResourceCatalog {
  const [revision, setRevision] = useState(0)
  const collectionKey = collection.kind === 'subscriptions'
    ? `subscriptions:${collection.topicName}`
    : collection.kind
  const query = useInfiniteQuery({
    queryKey: ['resource-pages', profileId, collectionKey, revision],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => invoke('listResourcePage', {
      profileId,
      collection,
      cursor: pageParam,
      pageSize: 50,
      force: pageParam === null && revision > 0
    }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    retry: false,
    staleTime: 60_000
  })
  const cursorError = useMemo(() => {
    const cursors = query.data?.pages.map((page) => page.nextCursor).filter((cursor): cursor is string => Boolean(cursor)) ?? []
    return new Set(cursors).size === cursors.length ? null : new Error('El broker devolvio un cursor repetido')
  }, [query.data])
  const { error: queryError, fetchNextPage, hasNextPage, isFetchingNextPage } = query

  useEffect(() => {
    if (!enabled || !hasNextPage || isFetchingNextPage || queryError || cursorError) return
    void fetchNextPage()
  }, [cursorError, enabled, fetchNextPage, hasNextPage, isFetchingNextPage, queryError])

  const entities = useMemo(() => {
    const byKey = new Map<string, DiscoveredEntity>()
    for (const page of query.data?.pages ?? []) {
      for (const entity of page.entities) byKey.set(entity.key, entity)
    }
    return [...byKey.values()]
  }, [query.data])
  const totalCount = query.data?.pages.findLast((page) => page.totalCount !== null)?.totalCount ?? null
  const latencyMs = query.data?.pages.reduce((total, page) => total + page.latencyMs, 0) ?? 0
  const error = cursorError ?? (query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null)

  return {
    entities,
    loadedCount: entities.length,
    totalCount,
    latencyMs,
    isInitialLoading: query.isPending && entities.length === 0,
    isLoadingMore: query.isFetchingNextPage,
    isComplete: enabled && query.isSuccess && !query.hasNextPage && !query.isFetchingNextPage && !cursorError,
    error,
    retry: () => { void (query.data ? query.fetchNextPage() : query.refetch()) },
    refresh: () => setRevision((current) => current + 1)
  }
}
