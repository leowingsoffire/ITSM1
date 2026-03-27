import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user
  const adminHash = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@itsm1.local' },
    update: {},
    create: {
      email: 'admin@itsm1.local',
      passwordHash: adminHash,
      firstName: 'System',
      lastName: 'Admin',
      role: UserRole.ADMIN,
    },
  });
  console.log(`  Admin user: ${admin.email}`);

  // Create agent user
  const agentHash = await bcrypt.hash('agent123', 12);
  const agent = await prisma.user.upsert({
    where: { email: 'agent@itsm1.local' },
    update: {},
    create: {
      email: 'agent@itsm1.local',
      passwordHash: agentHash,
      firstName: 'Service',
      lastName: 'Agent',
      role: UserRole.AGENT,
    },
  });
  console.log(`  Agent user: ${agent.email}`);

  // Create end user
  const userHash = await bcrypt.hash('user123', 12);
  const endUser = await prisma.user.upsert({
    where: { email: 'user@itsm1.local' },
    update: {},
    create: {
      email: 'user@itsm1.local',
      passwordHash: userHash,
      firstName: 'John',
      lastName: 'Doe',
      role: UserRole.END_USER,
    },
  });
  console.log(`  End user: ${endUser.email}`);

  // Create a team
  const team = await prisma.team.upsert({
    where: { name: 'IT Support' },
    update: {},
    create: {
      name: 'IT Support',
      description: 'First-level IT support team',
    },
  });
  console.log(`  Team: ${team.name}`);

  // Create sample incidents
  const incident1 = await prisma.incident.upsert({
    where: { number: 'INC0000001' },
    update: {},
    create: {
      number: 'INC0000001',
      title: 'Email service not responding',
      description: 'Users are unable to send or receive emails since 9:00 AM.',
      priority: 'HIGH',
      impact: 'HIGH',
      urgency: 'HIGH',
      category: 'Email',
      status: 'IN_PROGRESS',
      createdById: endUser.id,
      assignedToId: agent.id,
      assignedTeamId: team.id,
    },
  });
  console.log(`  Incident: ${incident1.number} - ${incident1.title}`);

  const incident2 = await prisma.incident.upsert({
    where: { number: 'INC0000002' },
    update: {},
    create: {
      number: 'INC0000002',
      title: 'VPN connection dropping intermittently',
      description: 'Remote users report VPN disconnects every 15-20 minutes.',
      priority: 'MEDIUM',
      impact: 'MEDIUM',
      urgency: 'MEDIUM',
      category: 'Network',
      status: 'NEW',
      createdById: endUser.id,
    },
  });
  console.log(`  Incident: ${incident2.number} - ${incident2.title}`);

  // Create SLA policies
  const slaPolicies = [
    { name: 'Critical SLA', priority: 'CRITICAL' as const, responseTimeMinutes: 15, resolutionTimeMinutes: 60 },
    { name: 'High SLA', priority: 'HIGH' as const, responseTimeMinutes: 30, resolutionTimeMinutes: 240 },
    { name: 'Medium SLA', priority: 'MEDIUM' as const, responseTimeMinutes: 60, resolutionTimeMinutes: 480 },
    { name: 'Low SLA', priority: 'LOW' as const, responseTimeMinutes: 120, resolutionTimeMinutes: 1440 },
  ];
  for (const sla of slaPolicies) {
    await prisma.slaPolicy.upsert({
      where: { name: sla.name },
      update: {},
      create: sla,
    });
  }
  console.log('  SLA Policies created');

  console.log('\nSeed complete! Test accounts:');
  console.log('  admin@itsm1.local / admin123');
  console.log('  agent@itsm1.local / agent123');
  console.log('  user@itsm1.local  / user123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
