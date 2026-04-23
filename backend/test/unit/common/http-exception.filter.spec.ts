import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common'

import { HttpExceptionFilter } from '../../../src/common/filters/http-exception.filter'

/**
 * Build a minimal `ArgumentsHost` that exposes the `req` and `res` shape
 * the filter touches. We only care about `response.status().json()` being
 * called with the right payload and `request.log.error` being invoked for
 * 5xx — everything else is noise.
 */
function makeHost(): {
  host: ArgumentsHost
  status: jest.Mock
  json: jest.Mock
  logError: jest.Mock
} {
  const json = jest.fn()
  const status = jest.fn(() => ({ json }))
  const logError = jest.fn()
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({
        method: 'POST',
        url: '/api/job-positions/abc/cvs',
        log: { error: logError },
      }),
    }),
  } as unknown as ArgumentsHost
  return { host, status, json, logError }
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter

  beforeEach(() => {
    filter = new HttpExceptionFilter()
  })

  describe('HttpException passthrough', () => {
    it('preserves status + message from a NotFoundException', () => {
      const { host, status, json, logError } = makeHost()

      filter.catch(new NotFoundException('Missing CV'), host)

      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND)
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.NOT_FOUND,
          path: '/api/job-positions/abc/cvs',
        }),
      )
      // 4xx never triggers the 5xx error-log branch
      expect(logError).not.toHaveBeenCalled()
    })

    it('passes structured message objects through', () => {
      const { host, json } = makeHost()
      const exc = new BadRequestException({
        message: ['email must be a valid email'],
        error: 'Bad Request',
      })

      filter.catch(exc, host)

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: expect.objectContaining({
            error: 'Bad Request',
          }),
        }),
      )
    })
  })

  describe('Multer error mapping', () => {
    it('maps LIMIT_FILE_SIZE to 413 with a human message', () => {
      const { host, status, json, logError } = makeHost()
      // `multer` throws plain Errors with `name === 'MulterError'` and a `code`.
      const multerErr = Object.assign(new Error('File too large'), {
        name: 'MulterError',
        code: 'LIMIT_FILE_SIZE',
      })

      filter.catch(multerErr, host)

      expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE)
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          message: expect.stringContaining('10 MB'),
        }),
      )
      // Client-side mistake — not a server error, so no 5xx log spam
      expect(logError).not.toHaveBeenCalled()
    })

    it('maps LIMIT_FILE_COUNT to 400', () => {
      const { host, status } = makeHost()
      const multerErr = Object.assign(new Error('Too many files'), {
        name: 'MulterError',
        code: 'LIMIT_FILE_COUNT',
      })

      filter.catch(multerErr, host)

      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST)
    })

    it('maps LIMIT_UNEXPECTED_FILE to 400 and surfaces the field name', () => {
      const { host, json } = makeHost()
      const multerErr = Object.assign(new Error('Unexpected field'), {
        name: 'MulterError',
        code: 'LIMIT_UNEXPECTED_FILE',
        field: 'rogue',
      })

      filter.catch(multerErr, host)

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: expect.stringContaining('rogue'),
        }),
      )
    })

    it('maps unknown MulterError codes to 400 using the original message', () => {
      const { host, status, json } = makeHost()
      const multerErr = Object.assign(new Error('weird multer thing'), {
        name: 'MulterError',
        code: 'LIMIT_WHATEVER',
      })

      filter.catch(multerErr, host)

      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST)
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'weird multer thing',
        }),
      )
    })
  })

  describe('unknown errors', () => {
    it('returns 500 and logs through the request-scoped logger', () => {
      const { host, status, json, logError } = makeHost()

      filter.catch(new Error('boom'), host)

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR)
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        }),
      )
      expect(logError).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'http.request.error', statusCode: 500 }),
        expect.stringContaining('POST'),
      )
    })

    it('handles non-Error throws without crashing', () => {
      const { host, status, logError } = makeHost()

      filter.catch('string thrown as exception', host)

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR)
      // The wrapper converts the string to an Error before logging it.
      expect(logError).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({
            message: 'string thrown as exception',
          }),
        }),
        expect.any(String),
      )
    })
  })
})
