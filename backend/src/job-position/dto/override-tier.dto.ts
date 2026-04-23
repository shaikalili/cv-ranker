import { IsIn } from 'class-validator'
import { CVTier } from '../../common/types'

export class OverrideTierDto {
  @IsIn(['great', 'good', 'no-match'])
  tier!: CVTier
}
