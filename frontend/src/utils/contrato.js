// Contrato = exatamente 3 numeros (ex.: 251, 010), sem espaco ou outro caractere.
export const REGEX_CONTRATO = /^\d{3}$/;
export const MENSAGEM_CONTRATO = 'O contrato deve ter exatamente 3 números (ex.: 251).';

/** Filtra o que o usuario digita: so numeros, no maximo 3. */
export function soDigitosContrato(valor) {
  return String(valor ?? '').replace(/\D/g, '').slice(0, 3);
}

export function contratoValido(valor) {
  return REGEX_CONTRATO.test(String(valor ?? ''));
}

/** TAG nao aceita espacos (letras e numeros colados). Sem limite de tamanho no campo. */
export function tagSemEspaco(valor) {
  return String(valor ?? '').replace(/\s/g, '');
}

// ---------------------------------------------------------------------------
// Contrato exibido (filtro global dos dashboards). So o Master escolhe; o valor
// '' significa "o meu contrato" (padrao). "todos" junta todos os contratos.
// ---------------------------------------------------------------------------
export const CONTRATO_TODOS = 'todos';
const CHAVE_CONTRATO = 'omegatrack_contrato_filtro';

export function lerContratoSelecionado() {
  try {
    const valor = localStorage.getItem(CHAVE_CONTRATO) || '';
    return valor === CONTRATO_TODOS || REGEX_CONTRATO.test(valor) ? valor : '';
  } catch {
    return '';
  }
}

export function salvarContratoSelecionado(valor) {
  try {
    if (valor) localStorage.setItem(CHAVE_CONTRATO, valor);
    else localStorage.removeItem(CHAVE_CONTRATO);
  } catch {
    /* armazenamento indisponivel */
  }
}

/**
 * Contrato em que um lancamento/importacao sera gravado: o do usuario; o Master
 * segue o filtro do topo (sem escolha: o proprio). null = "Todos" (precisa escolher).
 */
export function contratoDeLancamento(usuario) {
  if (!usuario) return null;
  const master = usuario.tipo === 'ADMINISTRADOR' && usuario.nivel === 'MASTER';
  if (!master) return usuario.contrato || null;
  const escolhido = lerContratoSelecionado();
  if (escolhido === CONTRATO_TODOS) return null;
  return escolhido || usuario.contrato || null;
}
