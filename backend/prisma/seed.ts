import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  const hashedPassword = await bcrypt.hash('demo123', 10)

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@demo.com' },
    update: {},
    create: {
      email: 'demo@demo.com',
      password: hashedPassword,
      name: 'Demo Recruiter',
    },
  })

  console.log(`✅ Demo user: ${demoUser.email}`)

  const sampleJd = `We are looking for a Senior Backend Engineer to join our team.

Requirements:
- 5+ years of experience with Node.js
- Strong experience with TypeScript
- Kubernetes production experience required
- React knowledge for occasional frontend work
- AWS or GCP experience is a plus
- Docker certification nice to have
- Team leadership experience preferred`

  const sampleRequirements = [
    {
      id: 'req_1',
      text: '5+ years Node.js experience',
      type: 'experience',
      weight: 9,
      isRequired: true,
      keywords: ['node.js', 'nodejs', 'node'],
      synonyms: ['express', 'nestjs', 'javascript backend'],
    },
    {
      id: 'req_2',
      text: 'TypeScript proficiency',
      type: 'technology',
      weight: 8,
      isRequired: true,
      keywords: ['typescript', 'ts'],
      synonyms: ['typed javascript'],
    },
    {
      id: 'req_3',
      text: 'Kubernetes production experience',
      type: 'technology',
      weight: 9,
      isRequired: true,
      keywords: ['kubernetes', 'k8s'],
      synonyms: ['container orchestration', 'kube'],
    },
    {
      id: 'req_4',
      text: 'React for frontend work',
      type: 'technology',
      weight: 6,
      isRequired: false,
      keywords: ['react', 'reactjs'],
      synonyms: ['react.js', 'jsx', 'redux'],
    },
    {
      id: 'req_5',
      text: 'AWS or GCP experience',
      type: 'technology',
      weight: 5,
      isRequired: false,
      keywords: ['aws', 'gcp'],
      synonyms: ['amazon web services', 'google cloud'],
    },
  ]

  const sampleJobPosition = await prisma.jobPosition.upsert({
    where: { id: 'demo-job-position-1' },
    update: {},
    create: {
      id: 'demo-job-position-1',
      userId: demoUser.id,
      title: 'Senior Backend Engineer — Demo Position',
      jobDescriptionText: sampleJd,
      requirements: sampleRequirements,
      status: 'REQUIREMENTS_EXTRACTED',
    },
  })

  console.log(`✅ Sample job position: ${sampleJobPosition.title}`)
  console.log('')
  console.log('🎉 Seed complete! Login with demo@demo.com / demo123')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
