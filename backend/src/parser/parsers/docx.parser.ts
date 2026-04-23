import { Injectable } from '@nestjs/common'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'
import * as mammoth from 'mammoth'

import { IParser, ParseResult } from './parser.interface'

@Injectable()
export class DocxParser implements IParser {
  constructor(
    @InjectPinoLogger(DocxParser.name)
    private readonly logger: PinoLogger,
  ) {}

  canParse(mimeType: string, filename: string): boolean {
    return (
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      filename.toLowerCase().endsWith('.docx')
    )
  }

  async parse(buffer: Buffer): Promise<ParseResult> {
    try {
      const result = await mammoth.extractRawText({ buffer })
      const text = result.value.trim()

      if (text.length < 50) {
        return {
          rawText: text,
          confidence: 'failed',
          error: 'DOCX parsed but no meaningful text was extracted.',
        }
      }

      return { rawText: text, confidence: 'high' }
    } catch (err) {
      const reason = (err as Error).message || 'Unknown DOCX parse error'
      this.logger.error(
        { event: 'parser.docx.failed', err },
        'DOCX parse failed',
      )
      return {
        rawText: '',
        confidence: 'failed',
        error: `Could not read DOCX: ${reason}`,
      }
    }
  }
}
