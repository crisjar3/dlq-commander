export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable = true,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'AppError'
  }
}

export function toSafeError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof Error) {
    const sanitized = error.message
      .replace(/amqps?:\/\/[^\s@]+@/gi, 'amqp://[credentials]@')
      .replace(/Endpoint=sb:\/\/[^;]+;[^\s]+/gi, 'Endpoint=[redacted]')
    return new AppError('UNEXPECTED_ERROR', sanitized, true, { cause: error })
  }
  return new AppError('UNEXPECTED_ERROR', 'Ocurrio un error inesperado', true)
}
