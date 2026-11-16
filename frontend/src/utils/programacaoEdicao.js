// ============================================================================
// Edição de uma linha da Programação (funções puras, usadas pela tela e testes).
// Motorista da manhã = operador principal; motorista da tarde = 2º motorista
// de ônibus/vans (operadorTardeMatricula).
// ============================================================================

export const CAMPOS_EDITAVEIS = ['obraId', 'operadorMatricula', 'operadorTardeMatricula', 'supervisorMatricula'];
const PESSOAS = ['operadorMatricula', 'operadorTardeMatricula', 'supervisorMatricula'];

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Ônibus, micro-ônibus e vans têm dois motoristas (manhã/tarde).
export function ehOnibusOuVan(categoria) {
  return /onibus|\bvans?\b/.test(normalizar(categoria));
}

export function valoresOriginais(original) {
  return Object.fromEntries(CAMPOS_EDITAVEIS.map((campo) => [campo, original?.[campo] || null]));
}

/**
 * Aplica `mudanca` sobre a linha (original do servidor + edição em andamento).
 * - Sem obra, todas as pessoas são liberadas.
 * - Escolher para um turno quem já está no outro troca os dois de lugar
 *   (a mesma pessoa nunca fica nos dois turnos).
 * @returns o estado editado, ou null quando voltou a ser igual ao original.
 */
export function mesclarAlteracao(original, atual, mudanca) {
  const base = valoresOriginais(original);
  const anterior = { ...base, ...atual };
  const editado = { ...anterior, ...mudanca };

  const manha = editado.operadorMatricula;
  const tarde = editado.operadorTardeMatricula;
  if (manha && manha === tarde) {
    if ('operadorMatricula' in mudanca && !('operadorTardeMatricula' in mudanca)) {
      editado.operadorTardeMatricula = anterior.operadorMatricula;
    } else if ('operadorTardeMatricula' in mudanca && !('operadorMatricula' in mudanca)) {
      editado.operadorMatricula = anterior.operadorTardeMatricula;
    }
  }
  if (!editado.obraId) for (const campo of PESSOAS) editado[campo] = null;

  return CAMPOS_EDITAVEIS.every((campo) => editado[campo] === base[campo]) ? null : editado;
}

// Mudança que inverte os turnos (Manhã ↔ Tarde).
export function mudancaInverterTurnos(original, atual) {
  const anterior = { ...valoresOriginais(original), ...atual };
  return {
    operadorMatricula: anterior.operadorTardeMatricula,
    operadorTardeMatricula: anterior.operadorMatricula,
  };
}

// Item do PUT /lote: obra sempre; pessoas só quando mudaram.
export function alteracaoParaSalvar(tag, original, valores) {
  const base = valoresOriginais(original);
  const alteracao = { tag, obraId: valores.obraId };
  for (const campo of PESSOAS) {
    if (valores[campo] !== base[campo]) alteracao[campo] = valores[campo];
  }
  return alteracao;
}
