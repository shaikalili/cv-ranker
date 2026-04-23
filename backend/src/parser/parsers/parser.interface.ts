import { ParsingConfidence } from '../../common/types'

export interface IParser {
  canParse(mimeType: string, filename: string): boolean
  parse(buffer: Buffer): Promise<ParseResult>
}

export interface ParseResult {
  rawText: string
  confidence: ParsingConfidence
  error?: string
}
