import { randomUUID } from 'node:crypto'
import type { OperationJob } from '@shared/domain'
import { AppError, toSafeError } from '../core/errors'
import type { BrokerRegistry } from '../brokers/BrokerRegistry'
import type { ProfileRepository } from '../persistence/ProfileRepository'
import type { AuditRepository } from '../persistence/AuditRepository'
import type { ArchiveRepository } from '../persistence/ArchiveRepository'

export interface RequeueRequest {
  profileId: string
  sourceId: string
  targetName: string
  messageIds: string[]
  throttlePerSecond: number
}

interface JobControl {
  job: OperationJob
  cancelled: boolean
}

export class JobRunner {
  private readonly jobs = new Map<string, JobControl>()

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly registry: BrokerRegistry,
    private readonly audit: AuditRepository,
    private readonly archive: ArchiveRepository,
    private readonly emit: (job: OperationJob) => void
  ) {}

  start(request: RequeueRequest): OperationJob {
    const profile = this.profiles.get(request.profileId)
    if (profile.readOnly) {
      throw new AppError('PROFILE_READ_ONLY', 'El perfil esta en modo solo lectura. Habilita operaciones antes de reenviar.')
    }
    const activeForSource = [...this.jobs.values()].some(
      ({ job }) =>
        job.profileId === request.profileId &&
        job.sourceId === request.sourceId &&
        (job.status === 'queued' || job.status === 'running')
    )
    if (activeForSource) throw new AppError('JOB_ALREADY_RUNNING', 'Ya existe una operacion activa para esta fuente.')

    const job: OperationJob = {
      id: randomUUID(),
      profileId: request.profileId,
      sourceId: request.sourceId,
      targetName: request.targetName,
      status: 'queued',
      total: request.messageIds.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      throttlePerSecond: request.throttlePerSecond,
      error: null,
      startedAt: null,
      finishedAt: null
    }
    const control = { job, cancelled: false }
    this.jobs.set(job.id, control)
    queueMicrotask(() => void this.run(control, request))
    return structuredClone(job)
  }

  cancel(id: string): OperationJob {
    const control = this.jobs.get(id)
    if (!control) throw new AppError('JOB_NOT_FOUND', `No existe el job ${id}`)
    if (control.job.status === 'queued' || control.job.status === 'running') control.cancelled = true
    return structuredClone(control.job)
  }

  list(): OperationJob[] {
    return [...this.jobs.values()].map(({ job }) => structuredClone(job)).reverse()
  }

  private async run(control: JobControl, request: RequeueRequest): Promise<void> {
    const { job } = control
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    this.publish(job)
    this.audit.write({
      action: 'requeue',
      profileId: job.profileId,
      sourceId: job.sourceId,
      targetName: job.targetName,
      status: 'started',
      requested: job.total,
      succeeded: 0,
      failed: 0,
      detail: `job=${job.id}`
    })

    try {
      const adapter = this.registry.get(job.profileId)
      const snapshotPage = await adapter.listMessages(job.sourceId, Math.min(job.total * 3, 500))
      const snapshots = new Map(snapshotPage.items.map((message) => [message.id, message]))
      const intervalMs = 1000 / request.throttlePerSecond

      for (const [index, messageId] of request.messageIds.entries()) {
        if (control.cancelled) {
          job.status = 'cancelled'
          break
        }
        if (index > 0) await this.delay(intervalMs)
        try {
          const snapshot = snapshots.get(messageId)
          if (!snapshot) {
            throw new AppError('ARCHIVE_SOURCE_MISSING', `No se pudo archivar ${messageId}; no se ejecutó el requeue.`)
          }
          this.archive.archive(job.id, job.profileId, snapshot)
          await adapter.requeueMessage(job.sourceId, job.targetName, messageId)
          job.succeeded += 1
        } catch (error) {
          job.failed += 1
          job.error = toSafeError(error).message
        }
        job.processed += 1
        this.publish(job)
      }

      if (job.status !== 'cancelled') job.status = job.failed === job.total ? 'failed' : 'completed'
    } catch (error) {
      const safeError = toSafeError(error)
      job.status = 'failed'
      job.error = safeError.message
    } finally {
      job.finishedAt = new Date().toISOString()
      this.audit.write({
        action: 'requeue',
        profileId: job.profileId,
        sourceId: job.sourceId,
        targetName: job.targetName,
        status: job.status === 'completed' ? 'completed' : job.status === 'cancelled' ? 'cancelled' : 'failed',
        requested: job.total,
        succeeded: job.succeeded,
        failed: job.failed,
        detail: job.error ? `job=${job.id}; ${job.error}` : `job=${job.id}`
      })
      this.publish(job)
    }
  }

  private publish(job: OperationJob): void {
    this.emit(structuredClone(job))
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
}
