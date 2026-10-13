import prisma from '../src/config/database.js';

const total = await prisma.mobDesmob.count();
console.log('mob_desmob total:', total);
const comFoto = await prisma.mobDesmob.count({ where: { foto_veiculo: { not: null } } });
console.log('com foto_veiculo:', comFoto);
const porStatus = await prisma.mobDesmob.groupBy({ by: ['status'], _count: true });
console.log('por status:', JSON.stringify(porStatus));
await prisma.$disconnect();
