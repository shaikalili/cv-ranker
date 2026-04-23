import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

class RequirementDto {
  @IsString()
  id!: string

  @IsString()
  text!: string

  @IsIn(['technology', 'experience', 'education', 'softSkill'])
  type!: 'technology' | 'experience' | 'education' | 'softSkill'

  @IsInt()
  @Min(1)
  @Max(10)
  weight!: number

  @IsBoolean()
  isRequired!: boolean

  @IsArray()
  @IsString({ each: true })
  keywords!: string[]

  @IsArray()
  @IsString({ each: true })
  synonyms!: string[]
}

export class UpdateRequirementsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequirementDto)
  requirements!: RequirementDto[]
}
