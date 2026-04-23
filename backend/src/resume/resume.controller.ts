import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { CV } from '@prisma/client'

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { ResumeService } from './resume.service'

@Controller('cvs')
@UseGuards(JwtAuthGuard)
export class ResumeController {
  constructor(private readonly resumeService: ResumeService) {}

  @Get(':id')
  findOne(@Param('id') id: string): Promise<CV> {
    return this.resumeService.findById(id)
  }
}
