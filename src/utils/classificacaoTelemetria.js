// ============================================================================
// src/utils/classificacaoTelemetria.js — Regras de Telemetria & Fadiga.
//
// Fonte: PGS-007245 Rev. 03 (Diretrizes para Monitoramento de Fadiga e Telemetria
// Veicular) e o seu Anexo I (Matriz de Avaliação de Condutas). Funções puras,
// sem banco: usadas pela importação da planilha, pelo cadastro manual e pela listagem.
// ============================================================================

/** Tipos de evento exibidos na tela (valor gravado em `evento`). */
export const EVENTOS = Object.freeze({
  VELOCIDADE: 'Excesso de Velocidade',
  ARRANCADA: 'Arrancada Brusca',
  FREADA: 'Freada de Emergência',
  FADIGA: 'Fadiga / Sono',
  FADIGA_SEM_PARADA: 'Fadiga sem Parada Obrigatória',
  CELULAR: 'Uso de Celular',
  CINTO_MOTORISTA: 'Cinto de Segurança (Motorista)',
  CINTO_PASSAGEIRO: 'Cinto de Segurança (Passageiro)',
  OBSTRUCAO_CAMERA: 'Obstrução de Câmera',
  PASSAGEM_NIVEL: 'Passagem em Nível sem Parada',
  AREA_PROIBIDA: 'Acesso a Área Proibida',
  ULTRAPASSAGEM: 'Ultrapassagem em Local Proibido',
  ETILOTESTE: 'Etiloteste Positivo',
  PRONTIDAO: 'Não Conformidade na Prontidão',
  COMPORTAMENTO_INSEGURO: 'Comportamento Inseguro',
  EMERGENCIA: 'Emergência / Pânico',
});

export const LISTA_EVENTOS = Object.values(EVENTOS);

/** NORMAL = dentro da tolerância (sem conduta a avaliar). GRAVE = "Significativo" no Anexo I. */
export const SEVERIDADES = ['NORMAL', 'MODERADO', 'GRAVE', 'CRITICO'];
export const STATUS_TRATATIVA = ['PENDENTE', 'TRATADO', 'DESCARTADO'];

/** Prazo padrão de devolutiva da tratativa à Central (item 7.4 / PNR-000070). */
export const PRAZO_TRATATIVA_DIAS = 15;

const COMITE = 'Aplicar Comitê Pela Vida (PNR-000267 – Gestão de Condutas para SSMA)';
const SEM_MEDIDA = 'Sem medida definida na matriz para esta recorrência: avaliar com a SSO local';

/**
 * Anexo I — medidas por número de eventos do mesmo tipo no mês (1º, 2º, 3º ou mais).
 * `null` = célula vazia na matriz. Chave: evento → severidade → [1º, 2º, 3º+].
 */
export const MATRIZ = {
  [EVENTOS.VELOCIDADE]: {
    MODERADO: ['Advertência verbal', 'Advertência escrita', COMITE],
    GRAVE: ['Advertência escrita', 'Suspensão de RAC', COMITE],
    CRITICO: [null, null, COMITE],
  },
  [EVENTOS.FADIGA]: {
    CRITICO: [
      'Elegíveis: reativação por no mínimo 15 min + reteste no Prontidão. Não elegíveis: reativação por no mínimo 15 min + conversa formal com o líder',
      'Elegíveis: reativação por no mínimo 15 min + reteste no Prontidão + encaminhamento à medicina. Não elegíveis: conversa formal com o líder + encaminhamento à medicina',
      'Elegíveis: reativação por no mínimo 15 min + reteste no Prontidão + encaminhamento à medicina. Não elegíveis: conversa formal com o líder + encaminhamento à medicina',
    ],
  },
  [EVENTOS.FADIGA_SEM_PARADA]: { CRITICO: ['Advertência escrita', 'Suspensão de RAC', COMITE] },
  [EVENTOS.PRONTIDAO]: {
    CRITICO: ['Empregado / gestor: advertência verbal', 'Empregado / gestor: advertência escrita', COMITE],
  },
  [EVENTOS.COMPORTAMENTO_INSEGURO]: { MODERADO: ['Advertência verbal', 'Advertência escrita', null] },
  // Arrancada e freada bruscas não têm linha própria: entram como condição/comportamento inseguro.
  [EVENTOS.ARRANCADA]: { MODERADO: ['Advertência verbal', 'Advertência escrita', null] },
  [EVENTOS.FREADA]: { MODERADO: ['Advertência verbal', 'Advertência escrita', null] },
  [EVENTOS.CINTO_PASSAGEIRO]: { CRITICO: ['Advertência escrita', 'Advertência escrita', null] },
  [EVENTOS.CINTO_MOTORISTA]: { CRITICO: [COMITE, COMITE, COMITE] },
  [EVENTOS.PASSAGEM_NIVEL]: { CRITICO: [COMITE, COMITE, COMITE] },
  [EVENTOS.AREA_PROIBIDA]: { CRITICO: [COMITE, COMITE, COMITE] },
  [EVENTOS.OBSTRUCAO_CAMERA]: { CRITICO: [COMITE, COMITE, COMITE] },
  [EVENTOS.CELULAR]: { CRITICO: [COMITE, COMITE, COMITE] },
  [EVENTOS.ETILOTESTE]: { CRITICO: [COMITE, COMITE, COMITE] },
  [EVENTOS.ULTRAPASSAGEM]: { CRITICO: [COMITE, COMITE, COMITE] },
};

/** Severidade e classificação fixas por tipo (velocidade é calculada pelo % de excesso). */
const SEVERIDADE_FIXA = {
  [EVENTOS.FADIGA]: ['CRITICO', 'N3'],
  [EVENTOS.FADIGA_SEM_PARADA]: ['CRITICO', 'N3'],
  [EVENTOS.PRONTIDAO]: ['CRITICO', 'N3'],
  [EVENTOS.CELULAR]: ['CRITICO', 'N3'],
  [EVENTOS.CINTO_MOTORISTA]: ['CRITICO', 'N3'],
  [EVENTOS.CINTO_PASSAGEIRO]: ['CRITICO', 'N3'],
  [EVENTOS.OBSTRUCAO_CAMERA]: ['CRITICO', 'N3'],
  [EVENTOS.PASSAGEM_NIVEL]: ['CRITICO', 'N3'],
  [EVENTOS.AREA_PROIBIDA]: ['CRITICO', 'N3'],
  [EVENTOS.ULTRAPASSAGEM]: ['CRITICO', 'N3'],
  [EVENTOS.ETILOTESTE]: ['CRITICO', 'N3'],
  [EVENTOS.COMPORTAMENTO_INSEGURO]: ['MODERADO', 'N5'],
  [EVENTOS.ARRANCADA]: ['MODERADO', 'N5'],
  [EVENTOS.FREADA]: ['MODERADO', 'N5'],
  // Alerta operacional (item 7.1, prioridade primária), não é conduta a avaliar.
  [EVENTOS.EMERGENCIA]: ['CRITICO', null],
};

/** Minúsculas, sem acentos e com espaços simples, para comparar textos da plataforma. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Traduz o texto do evento da plataforma para o tipo da tela.
 * Devolve `{ evento }`, `{ auxiliar: 'DURACAO_VELOCIDADE', duracao_s }` (complemento de um
 * excesso já registrado) ou `null` para o que não é evento de conduta (posição, ignição,
 * cercas, operadora celular, cadastro do sensor, bateria...).
 */
export function classificarTexto(textoOriginal) {
  const t = normalizar(textoOriginal);
  if (!t || t === 'null') return null;

  const tempoTotal = t.match(/tempo total em velocidade maxima.*tempo total: (\d+)/);
  if (tempoTotal) return { auxiliar: 'DURACAO_VELOCIDADE', duracao_s: Number(tempoTotal[1]) };

  // "Operadora Celular: VIVO" é a rede da linha de dados, não uso de celular pelo motorista.
  if (/operadora celular|troca operadora|troca tecnologia/.test(t)) return null;
  if (/sensor de fadiga: cadastro/.test(t)) return null;

  if (/sem parada obrigatoria/.test(t) && /fadiga/.test(t)) return { evento: EVENTOS.FADIGA_SEM_PARADA };
  if (/fadiga|sonolencia|\bsono\b|bocejo|olhos? fechad|microsono/.test(t)) return { evento: EVENTOS.FADIGA };
  if (/velocidade acima do limite|excedeu velocidade|excesso de velocidade|alerta de velocidade maxima/.test(t)) {
    const duracao = t.match(/excedeu velocidade maxima: (\d+) s/);
    return { evento: EVENTOS.VELOCIDADE, ...(duracao ? { duracao_s: Number(duracao[1]) } : {}) };
  }
  if (/arrancada|aceleracao brusca/.test(t)) return { evento: EVENTOS.ARRANCADA };
  if (/freada|frenagem/.test(t)) return { evento: EVENTOS.FREADA };
  if (/celular|telefone|smartphone/.test(t)) return { evento: EVENTOS.CELULAR };
  if (/cinto/.test(t)) return { evento: /passageiro/.test(t) ? EVENTOS.CINTO_PASSAGEIRO : EVENTOS.CINTO_MOTORISTA };
  if (/obstru|camera (bloqueada|coberta)/.test(t)) return { evento: EVENTOS.OBSTRUCAO_CAMERA };
  if (/passagem em nivel|\bpn\b/.test(t)) return { evento: EVENTOS.PASSAGEM_NIVEL };
  if (/area (de acesso )?proibid/.test(t)) return { evento: EVENTOS.AREA_PROIBIDA };
  if (/ultrapassagem/.test(t)) return { evento: EVENTOS.ULTRAPASSAGEM };
  if (/(etiloteste|etilometro|bafometro|alcool).*(positiv|alterad|reprov|acima)/.test(t)) return { evento: EVENTOS.ETILOTESTE };
  if (/prontidao/.test(t)) return { evento: EVENTOS.PRONTIDAO };
  if (/panico|botao de emergencia|tecla de emergencia/.test(t)) return { evento: EVENTOS.EMERGENCIA };
  if (/distracao|comportamento inseguro|condicao insegura|fumar|fumando|desvio de olhar|balaclava/.test(t)) {
    return { evento: EVENTOS.COMPORTAMENTO_INSEGURO };
  }
  return null;
}

/** Limite da cerca quando vem no próprio texto ("Limite maximo: 50 Km/h"). */
export function limiteDoTexto(textoOriginal) {
  const m = normalizar(textoOriginal).match(/limite maximo: (\d+(?:[.,]\d+)?) ?km\/h/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** % de excesso sobre o limite, com 2 casas (null sem velocidade ou limite). */
export function percentualExcesso(velocidade, limite) {
  if (!Number.isFinite(velocidade) || !Number.isFinite(limite) || limite <= 0) return null;
  return Math.round(((velocidade - limite) / limite) * 10000) / 100;
}

/**
 * Severidade do excesso de velocidade pelo Anexo I:
 * >7% e ≤20% Moderado (N5) · >20% e ≤50% Significativo (N3) · >50% e/ou >120 km/h Crítico (N3).
 * Até 7% fica dentro da tolerância (NORMAL, sem conduta).
 */
export function severidadeVelocidade(velocidade, limite) {
  const pct = percentualExcesso(velocidade, limite);
  if (Number.isFinite(velocidade) && velocidade > 120) return { severidade: 'CRITICO', classificacao: 'N3', percentual_excesso: pct };
  if (pct === null) return { severidade: 'MODERADO', classificacao: 'N5', percentual_excesso: null };
  if (pct > 50) return { severidade: 'CRITICO', classificacao: 'N3', percentual_excesso: pct };
  if (pct > 20) return { severidade: 'GRAVE', classificacao: 'N3', percentual_excesso: pct };
  if (pct > 7) return { severidade: 'MODERADO', classificacao: 'N5', percentual_excesso: pct };
  return { severidade: 'NORMAL', classificacao: null, percentual_excesso: pct };
}

/** Severidade, classificação e % de excesso de um evento já tipado. */
export function avaliarEvento(evento, valor, limite) {
  if (evento === EVENTOS.VELOCIDADE) return severidadeVelocidade(valor, limite);
  const [severidade, classificacao] = SEVERIDADE_FIXA[evento] || ['NORMAL', null];
  return { severidade, classificacao, percentual_excesso: null };
}

/**
 * Medida recomendada pelo Anexo I para a N-ésima ocorrência do mesmo tipo no mês.
 * Sem matriz para o evento/severidade (ex.: NORMAL, emergência) devolve null.
 */
export function medidaRecomendada(evento, severidade, ocorrencia) {
  const linha = MATRIZ[evento]?.[severidade];
  if (!linha) return null;
  const indice = Math.min(Math.max(Number(ocorrencia) || 1, 1), 3) - 1;
  return linha[indice] || SEM_MEDIDA;
}

