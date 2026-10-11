import prisma from '../config/database.js';

export async function obterResumoGeral() {
  const [totalVeiculos, veiculosMobilizados, docsVencendo, partesPendentes] = await Promise.all([
    prisma.mobDesmob.count(),
    prisma.mobDesmob.count({ where: { status: 'Mobilizado' } }),
    prisma.$queryRaw`
      SELECT COUNT(*)::int as qtd
      FROM documentacao_veiculos
      WHERE validade < CURRENT_DATE + INTERVAL '15 days'
    `,
    prisma.parteDiaria.count({ where: { status_assinatura: 'PENDENTE' } }),
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
