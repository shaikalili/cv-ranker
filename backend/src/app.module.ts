import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { PrismaModule } from './common/prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { JobDescriptionModule } from './job-description/job-description.module'
import { ResumeModule } from './resume/resume.module'
import { ParserModule } from './parser/parser.module'
import { AnonymizationModule } from './anonymization/anonymization.module'
import { FilterModule } from './filter/filter.module'
import { AiModule } from './ai/ai.module'
import { ScoringModule } from './scoring/scoring.module'
import { JobPositionModule } from './job-position/job-position.module'
import { CvGeneratorModule } from './cv-generator/cv-generator.module'

const SLOW_REQUEST_MS = 5_000
const QUIET_ROUTES = new Set(['/api/health', '/api/metrics'])

type ReqWithUser = IncomingMessage & {
  url?: string
  headers?: Record<string, string | string[] | undefined>
  user?: { id?: string; sub?: string }
  params?: Record<string, unknown>
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  colorize: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname,req,res,responseTime',
                  messageFormat:
                    '{if context}[{context}] {end}{if reqId}[{reqId}] {end}{msg}{if durationMs} ({durationMs}ms){end}',
                },
              }
            : undefined,
        genReqId: (req: IncomingMessage, res: ServerResponse): string => {
          const headers = (req as ReqWithUser).headers ?? {}
          const incoming = headers['x-request-id']
          const reqId =
            (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID()
          res.setHeader('x-request-id', reqId)
          return reqId
        },
        autoLogging: {
          ignore: (req: IncomingMessage) => {
            const url = (req as ReqWithUser).url ?? ''
            return QUIET_ROUTES.has(url.split('?')[0])
          },
        },
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error'
          if (res.statusCode >= 400) return 'warn'
          return 'info'
        },
        customSuccessMessage: (req, res, responseTime) => {
          const r = req as ReqWithUser
          const slow = responseTime > SLOW_REQUEST_MS ? ' [SLOW]' : ''
          return `${r.method ?? ''} ${r.url ?? ''} → ${res.statusCode} (${Math.round(responseTime)}ms)${slow}`
        },
        customErrorMessage: (req, res, _err) => {
          const r = req as ReqWithUser
          return `${r.method ?? ''} ${r.url ?? ''} → ${res.statusCode}`
        },
        customProps: (req) => {
          const r = req as ReqWithUser & { id?: string }
          return {
            userId: r.user?.sub ?? r.user?.id,
            reqId: r.id,
          }
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-api-key"]',
            'res.headers["set-cookie"]',
            '*.password',
            '*.apiKey',
            '*.OPENAI_API_KEY',
            '*.rawText',
            '*.anonymizedText',
          ],
          censor: '[REDACTED]',
          remove: false,
        },
        serializers: {
          req: (req: Record<string, unknown>) => ({
            method: req.method,
            url: req.url,
          }),
          res: (res: Record<string, unknown>) => ({
            statusCode: res.statusCode,
          }),
        },
      },
    }),

    PrismaModule,
    AuthModule,
    UsersModule,
    JobDescriptionModule,
    ResumeModule,
    ParserModule,
    AnonymizationModule,
    FilterModule,
    AiModule,
    ScoringModule,
    JobPositionModule,
    CvGeneratorModule,
  ],
})
export class AppModule {}
