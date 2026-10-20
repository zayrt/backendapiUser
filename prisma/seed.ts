import { prisma } from '../src/lib/prisma.ts'

const firstNames = [
  'Camille', 'Emma', 'Lucas', 'Jade', 'Nathan', 'Lea', 'Noah', 'Manon', 'Louis', 'Ines',
  'Gabriel', 'Sarah', 'Hugo', 'Lina', 'Adam', 'Clara', 'Ethan', 'Zoe', 'Raphael', 'Eva',
]
const lastNames = [
  'Petit', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Leroy', 'Roux', 'David', 'Bertrand',
  'Vincent', 'Fournier', 'Morel', 'Girard', 'Andre', 'Lefebvre', 'Mercier', 'Dupuis',
  'Lambert', 'Bonnet', 'Francois',
]

function shuffle(values: string[]): string[] {
  const shuffled = [...values]

  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
  }

  return shuffled
}

async function seedUsers() {
  const generatedNames = shuffle(
    firstNames.flatMap((firstName) => lastNames.map((lastName) => `${firstName} ${lastName}`)),
  ).slice(0, 100)
  const timestamp = new Date()

  const result = await prisma.user.createMany({
    skipDuplicates: true,
    data: [
      { id: 1, name: 'Alice Martin', email: 'alice@example.com', createdAt: timestamp, updatedAt: timestamp },
      { id: 2, name: 'Bilal Dupont', email: 'bilal@example.com', createdAt: timestamp, updatedAt: timestamp },
      { id: 3, name: 'Chloe Bernard', email: 'chloe@example.com', createdAt: timestamp, updatedAt: timestamp },
      ...generatedNames.map((name, index) => ({
        id: index + 4,
        name,
        email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    ],
  })

  await prisma.$queryRaw`
    SELECT setval(
      pg_get_serial_sequence('"User"', 'id'),
      GREATEST(COALESCE((SELECT MAX("id") FROM "User"), 1), 1)
    )
  `

  console.log(`${result.count} utilisateurs ont été ajoutés; les doublons ont été ignorés.`)
}

try {
  await seedUsers()
} catch (error) {
  console.error('Échec du seed Prisma :', error)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}