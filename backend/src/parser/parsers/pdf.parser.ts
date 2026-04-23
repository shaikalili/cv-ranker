import { Injectable } from '@nestjs/common'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'

import { IParser, ParseResult } from './parser.interface'


@Injectable()
export class PdfParser implements IParser {
  private static readonly MIN_TEXT_QUALITY_RATIO = 0.6
  private static readonly MIN_USEFUL_LENGTH = 50

  constructor(
    @InjectPinoLogger(PdfParser.name)
    private readonly logger: PinoLogger,
  ) {}

  canParse(mimeType: string, filename: string): boolean {
    return (
      mimeType === 'application/pdf' ||
      filename.toLowerCase().endsWith('.pdf')
    )
  }

  async parse(buffer: Buffer): Promise<ParseResult> {
    try {
      const text = await this.extractWithPdfJs(buffer)

      if (!text || text.length < PdfParser.MIN_USEFUL_LENGTH) {
        const msg =
          'PDF parsed but no meaningful text was extracted. This is usually an image-only/scanned PDF; OCR is not available.'
        this.logger.warn(
          { event: 'parser.pdf.empty_text', extractedLen: text?.length ?? 0 },
          msg,
        )
        return { rawText: '', confidence: 'failed', error: msg }
      }

      return {
        rawText: text,
        confidence: this.hasGoodTextQuality(text) ? 'high' : 'low',
      }
    } catch (err) {
      const reason = (err as Error).message || 'Unknown PDF parse error'
      this.logger.warn(
        { event: 'parser.pdf.failed', err },
        `pdfjs-dist failed to parse PDF`,
      )
      return {
        rawText: '',
        confidence: 'failed',
        error: `Could not read PDF: ${reason}`,
      }
    }
  }

  private async extractWithPdfJs(buffer: Buffer): Promise<string> {
    // `legacy` build is CJS so it works in Node 20 without an ESM loader.
    const pdfjsLib: typeof import('pdfjs-dist') =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('pdfjs-dist/legacy/build/pdf.js')

    const data = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    )

    const loadingTask = pdfjsLib.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    })

    const doc = await loadingTask.promise
    try {
      const pageTexts: string[] = []
      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum)
        try {
          const content = await page.getTextContent()
          pageTexts.push(this.reconstructPageText(content.items))
        } finally {
          page.cleanup()
        }
      }
      // Hard \n\n between pages so the sentence splitter can't glue page N end into page N+1 start.
      return pageTexts.join('\n\n').trim()
    } finally {
      await doc.destroy()
    }
  }

  // PDFs don't have real line breaks. Recover them from pdfjs `hasEOL` flags and baseline-y jumps.
  private reconstructPageText(items: Array<unknown>): string {
    type PdfTextItem = {
      str: string
      hasEOL?: boolean
      height?: number
      transform?: number[]
    }

    const textItems: PdfTextItem[] = items.filter(
      (item): item is PdfTextItem =>
        typeof item === 'object' &&
        item !== null &&
        'str' in item &&
        typeof (item as { str: unknown }).str === 'string',
    )
    if (textItems.length === 0) return ''

    const parts: string[] = []
    let lastKnownHeight = 12

    for (let i = 0; i < textItems.length; i++) {
      const item = textItems[i]
      const prev = i > 0 ? textItems[i - 1] : null
      const y = item.transform?.[5] ?? 0
      const height = item.height && item.height > 0 ? item.height : lastKnownHeight

      if (prev) {
        const prevY = prev.transform?.[5] ?? 0
        const yGap = Math.abs(prevY - y)
        const prevHadEOL = prev.hasEOL === true

        if (yGap > height * 1.8) {
          parts.push('\n\n')
        } else if (prevHadEOL || yGap > height * 0.4) {
          parts.push('\n')
        } else {
          const last = parts[parts.length - 1] ?? ''
          const needsSpace =
            last.length > 0 &&
            !last.endsWith(' ') &&
            !last.endsWith('\n') &&
            item.str.length > 0 &&
            !item.str.startsWith(' ')
          if (needsSpace) parts.push(' ')
        }
      }

      if (item.str) parts.push(item.str)
      if (item.height && item.height > 0) lastKnownHeight = item.height
    }

    return parts
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
  }

  // Garbled PDFs show a low letter-to-total-char ratio.
  private hasGoodTextQuality(text: string): boolean {
    if (text.length < PdfParser.MIN_USEFUL_LENGTH) return false

    const letterCount = text.match(/[a-zA-Z]/g)?.length ?? 0
    const ratio = letterCount / text.length
    return ratio >= PdfParser.MIN_TEXT_QUALITY_RATIO
  }
}
