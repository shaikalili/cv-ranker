import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'

import { PrismaService } from '../common/prisma/prisma.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'

export interface AuthPayload {
  sub: string
  email: string
}

export interface AuthResponse {
  accessToken: string
  user: {
    id: string
    email: string
    name: string
  }
}

@Injectable()
export class AuthService {
  private static readonly BCRYPT_ROUNDS = 10

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    })

    if (existing) {
      throw new ConflictException('Email already registered')
    }

    const hashedPassword = await bcrypt.hash(
      dto.password,
      AuthService.BCRYPT_ROUNDS,
    )

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
      },
    })

    return this.buildAuthResponse(user.id, user.email, user.name)
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    })

    if (!user) {
      throw new UnauthorizedException('Invalid credentials')
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password)

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials')
    }

    return this.buildAuthResponse(user.id, user.email, user.name)
  }

  async validateUserById(userId: string): Promise<AuthPayload | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    })

    if (!user) return null
    return { sub: user.id, email: user.email }
  }

  private buildAuthResponse(
    userId: string,
    email: string,
    name: string,
  ): AuthResponse {
    const payload: AuthPayload = { sub: userId, email }
    const accessToken = this.jwtService.sign(payload)

    return {
      accessToken,
      user: { id: userId, email, name },
    }
  }
}
