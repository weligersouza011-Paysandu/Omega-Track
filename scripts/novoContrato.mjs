// ============================================================================
// Implanta um CONTRATO NOVO: primeiro(s) administrador(es), planejador(es),
// operacionais e obras, a partir de um arquivo JSON (modelo: scripts/modelo-novo-contrato.json).
//   npm run contrato:novo -- --arquivo contrato-010.json            (simulacao: nada e gravado)
//   npm run contrato:novo -- --arquivo contrato-010.json --aplicar  (grava)
// Senha de administrador sem `senha` no arquivo e gerada e mostrada UMA vez.
// ============================================================================
import fs from 'node:fs';
import prisma from '../src/config/database.js';
import { planejarNovoContrato, aplicarNovoContrato } from '../src/services/implantacaoContrato.js';

const args = process.argv.slice(2);
const valorDe = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const arquivo = valorDe('--arquivo');
const aplicar = args.includes('--aplicar');

if (!arquivo) {
  console.error('Uso: npm run contrato:novo -- --arquivo <pedido.json> [--aplicar]\nModelo: scripts/modelo-novo-contrato.json');
  process.exit(2);
}

let pedido;
try {
  pedido = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
} catch (erro) {
  console.error(`Não consegui ler ${arquivo}: ${erro.message}`);
  process.exit(2);
}

try {
  const { erros, avisos, plano } = await planejarNovoContrato(prisma, pedido);
  if (erros.length) {
    console.error('\nPedido recusado:');
    erros.forEach((e) => console.error(`  ✖ ${e}`));
    process.exitCode = 1;
  } else {
    console.log(`\nContrato ${plano.contrato}`);
    console.log(`  administradores: ${plano.administradores.map((a) => `${a.nome} (${a.matricula}, ${a.setor})`).join('; ')}`);
    if (plano.operacionais.length) console.log(`  operacionais:    ${plano.operacionais.map((o) => `${o.nome} (${o.matricula})`).join('; ')}`);
    console.log(`  obras:           ${plano.obras.length ? plano.obras.map((o) => o.nome).join('; ') : '(nenhuma)'}`);
    avisos.forEach((a) => console.log(`  ! ${a}`));
    if (!aplicar) {
      console.log('\nSIMULAÇÃO: nada foi gravado. Confira e rode de novo com --aplicar.');
    } else {
      const r = await aplicarNovoContrato(prisma, plano);
      console.log(`\n✔ Contrato ${r.contrato} criado: ${r.usuarios} usuário(s) e ${r.obras} obra(s).`);
      if (r.senhasGeradas.length) {
        console.log('\nSenhas provisórias (mostradas só agora; peça para trocarem no primeiro acesso, em Meu Perfil):');
        r.senhasGeradas.forEach((s) => console.log(`  ${s.nome} — matrícula ${s.matricula} — senha ${s.senha}`));
      }
      console.log(`\nPróximo passo: npm run contrato:verificar`);
    }
  }
} finally {
  await prisma.$disconnect();
}
