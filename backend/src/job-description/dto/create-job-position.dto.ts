import { IsString, MinLength, MaxLength } from 'class-validator'

export class CreateJobPositionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string

  @IsString()
  @MinLength(50, {
    message: 'Job description must be at least 50 characters',
  })
  @MaxLength(20000)
  jobDescriptionText!: string
}
