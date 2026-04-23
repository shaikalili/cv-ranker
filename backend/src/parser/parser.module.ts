import { Module } from '@nestjs/common'

import { ParserService } from './parser.service'
import { PdfParser } from './parsers/pdf.parser'
import { DocxParser } from './parsers/docx.parser'
import { TextParser } from './parsers/text.parser'
import { SectionDetectorService } from './section-detector.service'
import { EntityExtractorService } from './entity-extractor.service'

@Module({
  providers: [
    ParserService,
    PdfParser,
    DocxParser,
    TextParser,
    SectionDetectorService,
    EntityExtractorService,
  ],
  exports: [ParserService],
})
export class ParserModule {}
