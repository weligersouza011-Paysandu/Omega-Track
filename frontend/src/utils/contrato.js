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
