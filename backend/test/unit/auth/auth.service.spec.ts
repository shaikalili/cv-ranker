import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { ConflictException, UnauthorizedException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'

import { AuthService } from '../../../src/auth/auth.service'
import { PrismaService } from '../../../src/common/prisma/prisma.service'

describe('AuthService', () => {
  let service: AuthService
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } }
  let jwt: { sign: jest.Mock }

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    }
    jwt = { sign: jest.fn().mockReturnValue('mock-jwt-token') }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile()

    service = module.get<AuthService>(AuthService)
  })

  describe('register', () => {
    it('should create a user with hashed password', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: 'user-1',
        ...data,
      }))

      const result = await service.register({
        email: 'new@example.com',
        password: 'secret123',
        name: 'New User',
      })

      const createCall = prisma.user.create.mock.calls[0][0]
      expect(createCall.data.password).not.toBe('secret123')
      expect(createCall.data.email).toBe('new@example.com')

      const passwordMatches = await bcrypt.compare(
        'secret123',
        createCall.data.password,
      )
      expect(passwordMatches).toBe(true)
      expect(result.accessToken).toBe('mock-jwt-token')
    })

    it('should throw ConflictException if email exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' })

      await expect(
        service.register({
          email: 'existing@example.com',
          password: 'secret123',
          name: 'Someone',
        }),
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('login', () => {
    it('should return auth response on valid credentials', async () => {
      const hashed = await bcrypt.hash('correct-password', 10)
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        password: hashed,
        name: 'User',
      })

      const result = await service.login({
        email: 'user@example.com',
        password: 'correct-password',
      })

      expect(result.accessToken).toBe('mock-jwt-token')
      expect(result.user.email).toBe('user@example.com')
    })

    it('should throw UnauthorizedException on unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(
        service.login({ email: 'nobody@example.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('should throw UnauthorizedException on wrong password', async () => {
      const hashed = await bcrypt.hash('correct-password', 10)
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        password: hashed,
        name: 'User',
      })

      await expect(
        service.login({
          email: 'user@example.com',
          password: 'WRONG',
        }),
      ).rejects.toThrow(UnauthorizedException)
    })
  })
})
