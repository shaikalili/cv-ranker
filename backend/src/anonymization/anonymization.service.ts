import { Injectable } from '@nestjs/common'

// Strips PII (name, contact, age, pronouns) before scoring to reduce LLM bias signals.
@Injectable()
export class AnonymizationService {
  private static readonly EMAIL_REGEX =
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

  private static readonly PHONE_REGEX =
    /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g

  private static readonly URL_REGEX = /https?:\/\/[^\s]+/g

  private static readonly GENDER_PRONOUNS = [
    'he/him', 'she/her', 'they/them', 'he/they', 'she/they',
  ]

  private static readonly DOB_PATTERNS = [
    /\bdate of birth[:\s]+[\d/.-]+/gi,
    /\bdob[:\s]+[\d/.-]+/gi,
    /\bborn(?:\s+on)?[:\s]+\d[\d/.-]+/gi,
    /\bage[:\s]+\d{1,2}\b/gi,
  ]

  private static readonly ADDRESS_PATTERNS = [
    /\baddress[:\s]+[^\n]+/gi,
    /\b\d+\s+[A-Z][a-z]+\s+(?:st|street|ave|avenue|rd|road|blvd)\b[^\n]*/gi,
  ]

  anonymize(rawText: string): string {
    let text = rawText

    text = text.replace(AnonymizationService.EMAIL_REGEX, '[EMAIL]')
    text = text.replace(AnonymizationService.PHONE_REGEX, '[PHONE]')
    text = text.replace(AnonymizationService.URL_REGEX, '[URL]')

    for (const pattern of AnonymizationService.ADDRESS_PATTERNS) {
      text = text.replace(pattern, '[ADDRESS]')
    }

    for (const pattern of AnonymizationService.DOB_PATTERNS) {
      text = text.replace(pattern, '[PERSONAL_DATA]')
    }

    for (const pronouns of AnonymizationService.GENDER_PRONOUNS) {
      const pattern = new RegExp(`\\(?${pronouns}\\)?`, 'gi')
      text = text.replace(pattern, '')
    }

    text = this.stripLikelyName(text)

    return text.trim()
  }

  // Heuristic: the first non-empty line of a CV is almost always the candidate name.
  private stripLikelyName(text: string): string {
    const lines = text.split('\n')
    const firstNonEmptyIndex = lines.findIndex((l) => l.trim().length > 0)

    if (firstNonEmptyIndex === -1) return text

    const firstLine = lines[firstNonEmptyIndex].trim()

    const words = firstLine.split(/\s+/)
    const looksLikeName =
      words.length >= 2 &&
      words.length <= 4 &&
      /^[A-Za-z\s'-]+$/.test(firstLine) &&
      firstLine.length < 60

    if (looksLikeName) {
      lines[firstNonEmptyIndex] = '[NAME]'
    }

    return lines.join('\n')
  }
}
