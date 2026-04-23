import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'
import type { Logger as PinoBaseLogger } from 'pino'
import PDFDocument from 'pdfkit'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from 'docx'
import pLimit from 'p-limit'

import { GenerateCVsDto, CVQualityTier } from './dto/generate-cvs.dto'
import { GeneratedCvContent } from './dto/generated-cv-content'
import { Requirement } from '../common/types'
import { AiService } from '../ai/ai.service'

export interface GeneratedCV {
  filename: string
  buffer: Buffer
  mimeType: string
  expectedTier: CVQualityTier
  metadata: {
    name: string
    yearsExperience: number
    technologies: string[]
  }
}

@Injectable()
export class CvGeneratorService {
  private readonly concurrencyLimit: number

  constructor(
    private readonly aiService: AiService,
    configService: ConfigService,
    @InjectPinoLogger(CvGeneratorService.name)
    private readonly logger: PinoLogger,
  ) {
    this.concurrencyLimit = Number(
      configService.get<string>('CV_GENERATION_CONCURRENCY_LIMIT', '10'),
    )
  }

  get cvGenerationConcurrencyLimit(): number {
    return this.concurrencyLimit
  }

  buildTierArray(dto: GenerateCVsDto): CVQualityTier[] {
    const { count, qualityMix } = dto
    const strongCount = Math.round(count * qualityMix.strong)
    const partialCount = Math.round(count * qualityMix.partial)
    const weakCount = count - strongCount - partialCount
    return [
      ...Array<CVQualityTier>(strongCount).fill('strong'),
      ...Array<CVQualityTier>(partialCount).fill('partial'),
      ...Array<CVQualityTier>(weakCount).fill('weak'),
    ]
  }

  // Failures are logged + skipped so a batch of N can return <N rather than blowing up.
  async generate(
    dto: GenerateCVsDto,
    jobTitle: string,
    requirements: Requirement[],
  ): Promise<GeneratedCV[]> {
    const tiers = this.buildTierArray(dto)

    const limit = pLimit(this.concurrencyLimit)
    const results = await Promise.all(
      tiers.map((tier, i) =>
        limit(() =>
          this.generateOne(this.logger.logger, tier, jobTitle, requirements, dto.format, i),
        ),
      ),
    )

    const succeeded = results.filter((r): r is GeneratedCV => r !== null)
    const failed = results.length - succeeded.length
    if (failed > 0) {
      this.logger.warn(
        {
          event: 'cv.generate_batch.partial_failure',
          requested: dto.count,
          produced: succeeded.length,
          failed,
        },
        'generate batch completed with failures',
      )
    }
    return succeeded
  }

  // Returns null on failure so streaming orchestrators can skip-and-continue.
  async generateOne(
    log: PinoBaseLogger,
    tier: CVQualityTier,
    jobTitle: string,
    requirements: Requirement[],
    format: 'pdf' | 'docx',
    index: number,
  ): Promise<GeneratedCV | null> {
    try {
      const { content } = await this.aiService.generateCvContent({
        jobTitle,
        tier,
        requirements,
      })

      const buffer =
        format === 'pdf'
          ? await this.renderPdf(content)
          : await this.renderDocx(content)

      const extension = format === 'pdf' ? 'pdf' : 'docx'
      const mimeType =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

      return {
        filename: `generated_${tier}_${index + 1}.${extension}`,
        buffer,
        mimeType,
        expectedTier: tier,
        metadata: {
          name: content.name,
          yearsExperience: content.yearsExperience,
          technologies: content.skills,
        },
      }
    } catch (err) {
      log.warn(
        {
          event: 'cv.generate_one.failed',
          err,
          tier,
          idx: index,
          format,
        },
        'generateOne failed',
      )
      return null
    }
  }

  // Every bullet ends with a period — the downstream parser splits sentences on `.!?`.
  private async renderPdf(data: GeneratedCvContent): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 })
      const chunks: Buffer[] = []

      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      doc.fontSize(22).fillColor('black').text(data.name, { align: 'left' })
      doc.fontSize(10).fillColor('#555').text(data.email)
      doc.moveDown(1.2)

      if (data.summary) {
        this.drawSectionHeading(doc, 'Summary')
        doc
          .fontSize(10)
          .fillColor('black')
          .text(this.ensureSentenceTerminator(data.summary), {
            paragraphGap: 4,
          })
        doc.moveDown(1)
      }

      if (data.experience.length > 0) {
        this.drawSectionHeading(doc, 'Experience')
        for (const entry of data.experience) {
          doc
            .fontSize(11)
            .fillColor('black')
            .text(`${entry.role} — ${entry.company}`)
          doc
            .fontSize(9)
            .fillColor('#777')
            .text(`${entry.startYear} – ${entry.endYear}`)
          doc.moveDown(0.3)

          doc.fontSize(10).fillColor('black')
          for (const bullet of entry.bullets) {
            doc.text(`• ${this.ensureSentenceTerminator(bullet)}`, {
              indent: 10,
              paragraphGap: 2,
            })
          }
          doc.moveDown(0.8)
        }
      }

      if (data.skills.length > 0) {
        this.drawSectionHeading(doc, 'Skills')
        doc
          .fontSize(10)
          .fillColor('black')
          .text(`${data.skills.join(', ')}.`)
        doc.moveDown(1)
      }

      if (data.education) {
        this.drawSectionHeading(doc, 'Education')
        doc
          .fontSize(10)
          .fillColor('black')
          .text(this.ensureSentenceTerminator(data.education))
      }

      doc.end()
    })
  }

  private drawSectionHeading(doc: PDFKit.PDFDocument, label: string): void {
    doc.fontSize(14).fillColor('black').text(label)
    doc.moveDown(0.4)
  }

  private ensureSentenceTerminator(line: string): string {
    const trimmed = line.trimEnd()
    if (/[.!?]$/.test(trimmed)) return trimmed
    return `${trimmed}.`
  }

  private async renderDocx(data: GeneratedCvContent): Promise<Buffer> {
    const children: Paragraph[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: data.name, bold: true, size: 32 })],
      }),
      new Paragraph({ text: data.email }),
      new Paragraph({ text: '' }),
    ]

    if (data.summary) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: 'Summary', bold: true })],
        }),
        new Paragraph({ text: this.ensureSentenceTerminator(data.summary) }),
      )
    }

    if (data.experience.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: 'Experience', bold: true })],
        }),
        ...data.experience.flatMap((entry) => [
          new Paragraph({
            children: [
              new TextRun({
                text: `${entry.role} — ${entry.company}`,
                bold: true,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `${entry.startYear} – ${entry.endYear}`,
                italics: true,
              }),
            ],
          }),
          ...entry.bullets.map(
            (b) =>
              new Paragraph({
                text: `• ${this.ensureSentenceTerminator(b)}`,
                indent: { left: 360 },
              }),
          ),
          new Paragraph({ text: '' }),
        ]),
      )
    }

    if (data.skills.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: 'Skills', bold: true })],
        }),
        new Paragraph({ text: data.skills.join(', ') }),
      )
    }

    if (data.education) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: 'Education', bold: true })],
        }),
        new Paragraph({ text: data.education }),
      )
    }

    const doc = new Document({ sections: [{ children }] })
    return Packer.toBuffer(doc)
  }
}
