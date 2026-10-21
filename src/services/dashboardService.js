import prisma from '../config/database.js';

export async function obterResumoGeral() {
  const [totalVeiculos, veiculosMobilizados, docsVencendo, partesPendentes] = await Promise.all([
    prisma.mobDesmob.count({ where: { deletado_em: null } }),
    prisma.mobDesmob.count({ where: { status: 'Mobilizado', deletado_em: null } }),
    prisma.$queryRaw`
      SELECT COUNT(*)::int as qtd
      FROM documentacao_veiculos d
      JOIN mob_desmob m ON m.tag = d.tag
      WHERE d.validade < CURRENT_DATE + INTERVAL '15 days'
        AND m.deletado_em IS NULL
    `,
    prisma.parteDiaria.count({ where: { status_assinatura: 'PENDENTE', deletado_em: null, veiculo: { deletado_em: null } } }),
  ]);

  return {
    frota: {
      total: totalVeiculos,
      mobilizados: veiculosMobilizados,
      desmobilizados: totalVeiculos - veiculosMobilizados,
    },
    documentacao: {
      criticos: docsVencendo?.[0]?.qtd || 0,
    },
    partes_diarias: {
      pendentes_assinatura: partesPendentes,
    },
  };
}
