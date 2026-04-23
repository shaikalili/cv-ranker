import { Injectable } from '@nestjs/common'
import { IParser, ParseResult } from './parser.interface'

@Injectable()
export class TextParser implements IParser {
  canParse(mimeType: string, filename: string): boolean {
    return (
      mimeType === 'text/plain' || filename.toLowerCase().endsWith('.txt')
    )
  }

  async parse(buffer: Buffer): Promise<ParseResult> {
    const text = buffer.toString('utf-8').trim()
    return {
      rawText: text,
      confidence: text.length > 50 ? 'high' : 'low',
    }
  }
}
