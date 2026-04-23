import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Logger, PinoLogger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'

async function bootstrap(): Promise<void> {
  // bufferLogs + pino so boot-time logs are structured, not raw console formatter.
  const app = await NestFactory.create(AppModule, { bufferLogs: true })

  app.useLogger(app.get(Logger))
  const pino = await app.resolve(PinoLogger)
  pino.setContext('Bootstrap')

  process.on('uncaughtException', (err) =>
    pino.error({ event: 'process.uncaught_exception', err }, 'uncaughtException'),
  )
  process.on('unhandledRejection', (reason) =>
    pino.error(
      {
        event: 'process.unhandled_rejection',
        err: reason instanceof Error ? reason : new Error(String(reason)),
      },
      'unhandledRejection',
    ),
  )

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())

  const configService = app.get(ConfigService)
  app.enableCors({
    origin: configService.get<string>('FRONTEND_URL', 'http://localhost:5173'),
    credentials: true,
  })
  app.setGlobalPrefix('api')

  const port = configService.get<number>('PORT', 3000)
  await app.listen(port)

  pino.info(
    { event: 'bootstrap.ready', port, nodeEnv: process.env.NODE_ENV },
    `CV Ranker backend listening on :${port}/api`,
  )
}

// Catch pre-useLogger throws so operators see a single clean line + non-zero exit.
bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err)
  // eslint-disable-next-line no-console -- logger isn't wired yet at this point
  console.error(
    JSON.stringify({
      event: 'bootstrap.failed',
      level: 'fatal',
      time: new Date().toISOString(),
      message,
    }),
  )
  process.exit(1)
})
