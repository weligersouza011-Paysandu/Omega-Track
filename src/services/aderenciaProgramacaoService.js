// ============================================================================
// Aderencia da Parte Diaria (RDO) a Programacao de Recursos.
// A Programacao (TAG + dia) e a fonte oficial da obra programada; o servidor
// compara com a obra real do RDO:
//   aderencia = true  -> seguiu a programacao
//   aderencia = false -> desvio (pede categoria + justificativa)
//   aderencia = null  -> veiculo sem programacao no dia (nao entra no indicador)
// ============================================================================

export const JUSTIFICATIVA_MIN = 10;
export const JUSTIFICATIVA_MAX = 2000;

// Dia (UTC 00:00) no mesmo formato das colunas DATE da programacao/RDO.
export function diaUtc(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function normalizarTexto(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Programacao do veiculo no dia (com a obra), ou null. */
export async function buscarProgramacaoDoDia(client, tag, data) {
  const dia = diaUtc(data);
  if (!tag || !dia) return null;
  return client.programacaoRecurso.findUnique({
    where: { tag_data: { tag: String(tag).trim(), data: dia } },
    select: {
      obra_id: true,
      operador_matricula: true, operador_nome: true,
      operador_tarde_matricula: true, operador_tarde_nome: true,
      supervisor_matricula: true, supervisor_nome: true,
      obra: {
        select: {
          id: true, nome: true, numero_contrato: true, contratante: true,
          gestao: true, planejador: true, ativo: true,
        },
      },
    },
  });
}

/**
 * Compara a obra real do RDO com a programada. Usa o ID da obra quando o RDO
 * tem obra do cadastro; senao cai para o nome (RDOs antigos com texto livre).
 * Programado e sem obra no RDO, ou com status do dia diferente de Operacao
 * (manutencao, indisponibilidade...), tambem e desvio: o veiculo nao
 * trabalhou na obra programada.
 */
export function avaliarAderencia(programacao, { obraId, obraTexto, statusOperacional = 'Operação' }) {
  if (!programacao?.obra) {
    return { obra_programada_id: null, obra_programada: null, aderencia: null };
  }
  let aderencia = false;
  if (statusOperacional && statusOperacional !== 'Operação') aderencia = false;
  else if (obraId) aderencia = obraId === programacao.obra.id;
  else if (normalizarTexto(obraTexto)) aderencia = normalizarTexto(obraTexto) === normalizarTexto(programacao.obra.nome);
  return {
    obra_programada_id: programacao.obra.id,
    obra_programada: programacao.obra.nome,
    aderencia,
  };
}

function erro400(message, extra = {}) {
  const e = new Error(message);
  e.statusCode = 400;
  Object.assign(e, extra);
  return e;
}

/**
 * Valida categoria/justificativa e devolve os campos a gravar.
 * Sem desvio, os campos sao limpos. Com desvio, o que vier precisa ser valido
 * (categoria ativa, justificativa com 10 a 2000 caracteres); a AUSENCIA nao
 * bloqueia o salvamento — fica como `justificativa_pendente` para a tela
 * cobrar antes de finalizar (o RDO e preenchido aos poucos, inclusive offline).
 */
export async function resolverJustificativa(client, aderencia, { categoriaId, justificativa, categoriaAtual = null }) {
  if (aderencia !== false) return { categoria_desvio_id: null, justificativa_desvio: null };

  let categoria_desvio_id = null;
  // A categoria ja gravada continua valida mesmo se o admin a desativou depois
  // (editar um RDO antigo nao pode travar por isso).
  if (categoriaId && categoriaAtual && String(categoriaId) === categoriaAtual) {
    categoria_desvio_id = categoriaAtual;
  } else if (categoriaId) {
    const categoria = await client.categoriaDesvioProgramacao.findUnique({
      where: { id: String(categoriaId) }, select: { id: true, ativo: true },
    }).catch(() => null);
    if (!categoria || !categoria.ativo) {
      throw erro400('Categoria de desvio inválida ou inativa. Atualize a página e escolha outra.');
    }
    categoria_desvio_id = categoria.id;
  }

  let justificativa_desvio = null;
  if (justificativa !== undefined && justificativa !== null && String(justificativa).trim() !== '') {
    const texto = String(justificativa).trim();
    if (texto.length < JUSTIFICATIVA_MIN || texto.length > JUSTIFICATIVA_MAX) {
      throw erro400(`A justificativa do desvio deve ter entre ${JUSTIFICATIVA_MIN} e ${JUSTIFICATIVA_MAX} caracteres.`);
    }
    justificativa_desvio = texto;
  }
  return { categoria_desvio_id, justificativa_desvio };
}

/** Resumo de aderencia exposto junto do RDO. */
export function statusAderencia(parte) {
  if (parte?.aderencia === true) return { status: 'ADERENTE', justificativa_pendente: false };
  if (parte?.aderencia === false) {
    return {
      status: 'DESVIO',
      justificativa_pendente: !parte.categoria_desvio_id || !parte.justificativa_desvio,
    };
  }
  return { status: 'SEM_PROGRAMACAO', justificativa_pendente: false };
}
