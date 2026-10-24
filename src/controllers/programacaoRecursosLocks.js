// Serializa alteracoes de programacao e manutencao para a mesma TAG.
// As TAGs sao ordenadas para evitar deadlock em operacoes em lote.
export async function bloquearEquipamentos(tx, tags) {
  for (const tag of [...new Set(tags)].sort()) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tag}, 0))::text`;
  }
}

export async function tagsEmManutencao(tx, tags) {
  if (!tags.length) return [];
  const abertas = await tx.manutencaoRecurso.findMany({
    where: { tag: { in: tags }, data_retorno: null },
    select: { tag: true },
  });
  return abertas.map((item) => item.tag);
}

export function erroEquipamentoEmManutencao(res, tags) {
  return res.status(409).json({
    error: 'Equipamento em manutencao',
    message: `A programacao de ${tags.join(', ')} esta bloqueada ate o retorno da manutencao. Atualize a pagina.`,
    tagsEmManutencao: tags,
  });
}
