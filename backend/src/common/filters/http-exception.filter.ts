import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import { Request, Response } from 'express'

// Multer throws non-HttpException errors for file-size/count violations; map them to 4xx instead of 5xx.
interface MulterErrorLike {
  name: string
  code?: string
  message?: string
  field?: string
}

function asMulterError(exception: unknown): MulterErrorLike | null {
  if (
    typeof exception === 'object' &&
    exception !== null &&
    (exception as MulterErrorLike).name === 'MulterError'
  ) {
    return exception as MulterErrorLike
  }
  return null
}

function mapMulterError(err: MulterErrorLike): { status: number; message: string } {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        message: 'One or more files exceed the per-file size limit (10 MB).',
      }
    case 'LIMIT_FILE_COUNT':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Too many files in a single upload.',
      }
    case 'LIMIT_UNEXPECTED_FILE':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: `Unexpected file field${err.field ? ` '${err.field}'` : ''}.`,
      }
    default:
      return {
        status: HttpStatus.BAD_REQUEST,
        message: err.message || 'Invalid multipart upload.',
      }
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request & { log?: import('pino').Logger }>()

    const multerErr = asMulterError(exception)

    let status: number
    let message: string | object

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      message = exception.getResponse()
    } else if (multerErr) {
      const mapped = mapMulterError(multerErr)
      status = mapped.status
      message = mapped.message
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR
      message = 'Internal server error'
    }

    if (status >= 500) {
      // request.log is the pino request-scoped child (reqId baked in).
      const log = request.log
      if (log) {
        log.error(
          {
            event: 'http.request.error',
            statusCode: status,
            err: exception instanceof Error ? exception : new Error(String(exception)),
          },
          `unhandled error on ${request.method} ${request.url}`,
        )
      } else {
        console.error('unhandled error before logger attached', exception)
      }
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    })
  }
}
