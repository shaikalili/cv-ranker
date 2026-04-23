import { Injectable, BadRequestException } from '@nestjs/common'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'

import { ParsedCV } from '../common/types'
import { IParser } from './parsers/parser.interface'
import { PdfParser } from './parsers/pdf.parser'
import { DocxParser } from './parsers/docx.parser'
import { TextParser } from './parsers/text.parser'
import { SectionDetectorService } from './section-detector.service'
import { EntityExtractorService } from './entity-extractor.service'

@Injectable()
export class ParserService {
  private readonly parsers: IParser[]

  constructor(
    pdfParser: PdfParser,
    docxParser: DocxParser,
    textParser: TextParser,
    private readonly sectionDetector: SectionDetectorService,
    private readonly entityExtractor: EntityExtractorService,
    @InjectPinoLogger(ParserService.name)
    private readonly logger: PinoLogger,
  ) {
    this.parsers = [pdfParser, docxParser, textParser]
  }

  async parse(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<ParsedCV> {
    const parser = this.parsers.find((p) => p.canParse(mimeType, filename))

    if (!parser) {
      throw new BadRequestException(
        `Unsupported file type: ${mimeType} / ${filename}`,
      )
    }

    const { rawText, confidence, error } = await parser.parse(buffer)

    if (confidence === 'failed' || !rawText || rawText.length < 50) {
      this.logger.warn(
        {
          event: 'parser.parse.failed',
          filename,
          mimeType,
          confidence,
          rawTextLen: rawText?.length ?? 0,
          reason: error,
        },
        'parse failed or text too short',
      )
    }

    const sections = this.sectionDetector.detect(rawText)
    const sentences = this.sectionDetector.splitIntoSentences(rawText)
    const entities = this.entityExtractor.extract(rawText, sections)

    return {
      rawText,
      sections,
      sentences,
      entities,
      parsingConfidence: confidence,
      parseError: error,
    }
  }
}
