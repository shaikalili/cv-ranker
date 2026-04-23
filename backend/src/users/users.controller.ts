import { Controller, Get, UseGuards } from '@nestjs/common'

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthPayload } from '../auth/auth.service'
import { UsersService, UserProfile } from './users.service'

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@CurrentUser() user: AuthPayload): Promise<UserProfile> {
    return this.usersService.getProfile(user.sub)
  }
}
