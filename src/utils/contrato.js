// ============================================================================
// Contrato = codigo de exatamente 3 digitos (ex.: 251, 010), sem espacos e sem
// nenhum outro caractere. Cada usuario pertence a UM contrato. O contrato
// "existe" a partir do momento em que um usuario/veiculo/obra e cadastrado com
// ele (nao ha tela nem tabela de cadastro de contratos).
// ============================================================================

// Todos os registros anteriores a esta regra pertencem ao contrato 251.
export const CONTRATO_PADRAO = '251';
export const REGEX_CONTRATO = /^\d{3}$/;
export const MENSAGEM_CONTRATO = 'O contrato deve ter exatamente 3 números, sem espaços ou outros caracteres (ex.: 251).';

export function contratoValido(valor) {
  return typeof valor === 'string' && REGEX_CONTRATO.test(valor);
}

function erroContrato(message) {
  const erro = new Error(message);
  erro.statusCode = 400;
  erro.error = 'Contrato invalido';
  return erro;
}

// Valida e devolve o contrato (string de 3 digitos) ou lanca erro 400.
// Numeros JSON sao recusados: 010 viraria 10 e perderia o zero a esquerda.
export function exigirContrato(valor, rotulo = 'Contrato') {
  if (valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')) {
    throw erroContrato(`${rotulo} é obrigatório. ${MENSAGEM_CONTRATO}`);
  }
  if (typeof valor !== 'string' || !contratoValido(valor.trim())) {
    throw erroContrato(`${rotulo} inválido. ${MENSAGEM_CONTRATO}`);
  }
  return valor.trim();
}

// Versao tolerante para planilhas: devolve o contrato ou null.
export function contratoOuNull(valor) {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  return contratoValido(texto) ? texto : null;
}

// TAG: sem espacos (letras e numeros colados). Nao ha limite de tamanho alem do
// da coluna.
export function tagSemEspaco(valor) {
  return typeof valor === 'string' && valor.length > 0 && !/\s/.test(valor);
}
export const MENSAGEM_TAG = 'A TAG não pode ter espaços (use letras e números colados, ex.: CA0388).';
