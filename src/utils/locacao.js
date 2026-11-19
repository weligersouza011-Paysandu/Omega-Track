// ============================================================================
// Locacao = onde o veiculo esta dentro do contrato (ex.: Serra Norte, Serra Leste).
// Opcional: contratos sem locacoes a deixam vazia. A lista de locacoes de cada
// contrato vem dos proprios veiculos cadastrados (nao ha cadastro separado); o
// nome e normalizado para "serra norte" e "Serra Norte" serem uma so.
// ============================================================================
export const TAMANHO_MAX_LOCACAO = 60;

function erro400(message) {
  const e = new Error(message);
  e.statusCode = 400;
  e.error = 'Locacao invalida';
  return e;
}

/** Chave de comparacao: sem acento, sem caixa e sem espacos sobrando. */
export function chaveLocacao(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Texto limpo (espacos colapsados) ou null quando vazio. */
export function limparLocacao(valor) {
  const texto = String(valor ?? '').replace(/\s+/g, ' ').trim();
  return texto === '' ? null : texto;
}

/** "serra  norte" -> "Serra Norte" (so quando o usuario digitou tudo em minusculas/maiusculas). */
function capitalizar(texto) {
  if (texto !== texto.toLowerCase() && texto !== texto.toUpperCase()) return texto; // ja tem caixa mista: respeita
  return texto.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, espaco, letra) => espaco + letra.toUpperCase());
}

/**
 * Locacoes ja usadas pelos veiculos do contrato (sem repeticao, ordenadas).
 * `cliente` = prisma ou tx.
 */
export async function locacoesDoContrato(cliente, contrato) {
  const grupos = await cliente.mobDesmob.groupBy({
    by: ['locacao'],
    where: { contrato, deletado_em: null, locacao: { not: null } },
  });
  return grupos.map((g) => g.locacao).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/**
 * Valida/normaliza a locacao informada para o contrato:
 *   - reaproveita o nome ja existente no contrato (ignora acento e caixa);
 *   - locacao nova entra capitalizada;
 *   - `obrigatoria`: se o contrato ja usa locacoes, nao pode ficar vazia.
 * Devolve a locacao canonica ou null.
 */
export async function resolverLocacao(cliente, contrato, valor, { obrigatoria = false } = {}) {
  const limpa = limparLocacao(valor);
  const existentes = await locacoesDoContrato(cliente, contrato);
  if (!limpa) {
    if (obrigatoria && existentes.length > 0) {
      throw erro400(`Informe a locação do veículo (${existentes.join(', ')} ou uma nova).`);
    }
    return null;
  }
  if (limpa.length > TAMANHO_MAX_LOCACAO) {
    throw erro400(`A locação aceita no máximo ${TAMANHO_MAX_LOCACAO} caracteres.`);
  }
  const chave = chaveLocacao(limpa);
  const igual = existentes.find((e) => chaveLocacao(e) === chave);
  return igual ?? capitalizar(limpa);
}
