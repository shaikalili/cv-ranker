-- CreateEnum
CREATE TYPE "JobPositionStatus" AS ENUM ('CREATED', 'REQUIREMENTS_EXTRACTED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_positions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jobDescriptionText" TEXT NOT NULL,
    "requirements" JSONB NOT NULL,
    "status" "JobPositionStatus" NOT NULL DEFAULT 'CREATED',
    "totalCvs" INTEGER NOT NULL DEFAULT 0,
    "processedCvs" INTEGER NOT NULL DEFAULT 0,
    "greatMatchCount" INTEGER NOT NULL DEFAULT 0,
    "goodMatchCount" INTEGER NOT NULL DEFAULT 0,
    "noMatchCount" INTEGER NOT NULL DEFAULT 0,
    "aiCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cvs" (
    "id" TEXT NOT NULL,
    "jobPositionId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "anonymizedText" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "sentences" JSONB NOT NULL,
    "entities" JSONB NOT NULL,
    "parsingConfidence" TEXT NOT NULL,
    "keywordScores" JSONB NOT NULL,
    "aiScores" JSONB,
    "finalScore" DOUBLE PRECISION,
    "tier" TEXT,
    "eliminationReason" TEXT,
    "aiModelUsed" TEXT,
    "aiCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cvs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "job_positions_userId_idx" ON "job_positions"("userId");

-- CreateIndex
CREATE INDEX "cvs_jobPositionId_idx" ON "cvs"("jobPositionId");

-- CreateIndex
CREATE INDEX "cvs_tier_idx" ON "cvs"("tier");

-- AddForeignKey
ALTER TABLE "job_positions" ADD CONSTRAINT "job_positions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cvs" ADD CONSTRAINT "cvs_jobPositionId_fkey" FOREIGN KEY ("jobPositionId") REFERENCES "job_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
