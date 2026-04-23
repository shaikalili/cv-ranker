import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

export type CVQualityTier = 'strong' | 'partial' | 'weak'

class QualityMixDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  strong!: number

  @IsNumber()
  @Min(0)
  @Max(1)
  partial!: number

  @IsNumber()
  @Min(0)
  @Max(1)
  weak!: number
}

// targetRole + keySkills are derived from the job position server-side so the generator matches the scorer.
export class GenerateCVsDto {
  @IsInt()
  @Min(1)
  @Max(100)
  count!: number

  @IsObject()
  @ValidateNested()
  @Type(() => QualityMixDto)
  qualityMix!: QualityMixDto

  @IsIn(['pdf', 'docx'])
  format!: 'pdf' | 'docx'
}
