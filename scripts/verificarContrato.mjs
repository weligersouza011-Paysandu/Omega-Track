// ============================================================================
// Verifica a integridade multi-contrato (somente leitura): quantos registros cada
// contrato tem, inconsistencias entre tabelas e o que a padronizacao fez com os
// valores antigos de "contrato". Sai com codigo 1 se achar ERRO (avisos nao falham).
//   npm run contrato:verificar
// ============================================================================
import prisma from '../src/config/database.js';
import { contagemPorContrato, verificarIntegridade, resumoLegado } from '../src/services/implantacaoContrato.js';

try {
  console.log('\n== Registros por contrato ==');
  const contagem = await contagemPorContrato(prisma);
  const contratos = Object.keys(contagem).sort();
  if (!contratos.length) console.log('  (banco sem dados)');
  for (const c of contratos) {
    console.log(`  Contrato ${c}: ${Object.entries(contagem[c]).map(([rotulo, n]) => `${rotulo} ${n}`).join(' · ')}`);
  }

  console.log('\n== Verificações ==');
  const checagens = await verificarIntegridade(prisma);
  for (const c of checagens) {
    const marca = c.ok ? '✔' : (c.gravidade === 'erro' ? '✖' : '!');
    console.log(`  ${marca} ${c.descricao}${c.ok ? '' : ` — ${c.quantidade}`}`);
    c.exemplos.forEach((e) => console.log(`        ${e}`));
  }

  console.log('\n== Valores antigos de contrato (backup da padronização) ==');
  const legado = await resumoLegado(prisma);
  if (!legado.existe) console.log('  (sem backup: banco criado já no modelo novo)');
  else if (!legado.linhas.length) console.log('  (backup vazio)');
  else {
    for (const l of legado.linhas) {
      console.log(`  ${l.tabela.padEnd(22)} ${String(l.valor_antigo ?? '(vazio)').padEnd(22)} ${String(l.quantidade).padStart(6)}  → locação: ${l.locacao ?? 'sem locação'}`);
    }
    const semLocacao = legado.linhas.filter((l) => l.tabela === 'mob_desmob' && l.valor_antigo && !l.locacao);
    if (semLocacao.length) console.log('  ! Valores sem locação correspondente (ajuste na tela de Frota ou me diga como mapear): ' + semLocacao.map((l) => l.valor_antigo).join(', '));
  }

  const erros = checagens.filter((c) => !c.ok && c.gravidade === 'erro');
  console.log(erros.length ? `\n✖ ${erros.length} verificação(ões) com ERRO: corrija antes de operar.` : '\n✔ Nenhum erro de integridade.');
  if (erros.length) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
