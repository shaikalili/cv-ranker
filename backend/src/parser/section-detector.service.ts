import { Injectable } from '@nestjs/common'
import { ParsedSections } from '../common/types'

@Injectable()
export class SectionDetectorService {
  private static readonly SECTION_PATTERNS = {
    experience: [
      /(?:^|\n)\s*(?:work\s+)?(?:professional\s+)?experience\b/i,
      /(?:^|\n)\s*employment(?:\s+history)?\b/i,
      /(?:^|\n)\s*work\s+history\b/i,
    ],
    skills: [
      /(?:^|\n)\s*(?:technical\s+|core\s+)?skills\b/i,
      /(?:^|\n)\s*technologies\b/i,
      /(?:^|\n)\s*(?:tech\s+)?stack\b/i,
      /(?:^|\n)\s*competencies\b/i,
    ],
    education: [
      /(?:^|\n)\s*education\b/i,
      /(?:^|\n)\s*academic(?:\s+background)?\b/i,
      /(?:^|\n)\s*degrees?\b/i,
      /(?:^|\n)\s*qualifications?\b/i,
    ],
    summary: [
      /(?:^|\n)\s*summary\b/i,
      /(?:^|\n)\s*about(?:\s+me)?\b/i,
      /(?:^|\n)\s*profile\b/i,
      /(?:^|\n)\s*objective\b/i,
    ],
  }

  detect(rawText: string): ParsedSections {
    const sections: ParsedSections = {
      experience: '',
      skills: '',
      education: '',
      summary: '',
      other: '',
    }

    const markers = this.findSectionMarkers(rawText)

    if (markers.length === 0) {
      sections.other = rawText
      return sections
    }

    markers.sort((a, b) => a.position - b.position)

    for (let i = 0; i < markers.length; i++) {
      const current = markers[i]
      const next = markers[i + 1]
      const start = current.position
      const end = next ? next.position : rawText.length
      sections[current.section] = rawText.slice(start, end).trim()
    }

    return sections
  }

  private findSectionMarkers(
    text: string,
  ): Array<{ section: keyof ParsedSections; position: number }> {
    const markers: Array<{
      section: keyof ParsedSections
      position: number
    }> = []

    for (const [section, patterns] of Object.entries(
      SectionDetectorService.SECTION_PATTERNS,
    )) {
      for (const pattern of patterns) {
        const match = text.match(pattern)
        if (match && match.index !== undefined) {
          markers.push({
            section: section as keyof ParsedSections,
            position: match.index,
          })
          break
        }
      }
    }

    return markers
  }

  // Splits on sentence punctuation, newlines, and common bullet glyphs PDFs inline as separators.
  // Keeps tokens ≥3 chars to preserve "Go", "C#", ".NET" while dropping stray single letters.
  splitIntoSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+|\n+|[\u2022\u25AA\u00B7\u25CF\u25E6\u2219\u25BA]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3)
  }
}
