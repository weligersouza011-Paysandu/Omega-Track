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
  // Só a fadiga DETECTADA pelo sensor é fadiga real (ou o rótulo da tela/planilha modelo).
  // Outros textos de fadiga (cadastro, alertas de análise) não viram evento.
  if (/fadiga detectada/.test(t) || t === 'fadiga / sono' || t === 'fadiga') return { evento: EVENTOS.FADIGA };
  if (/fadiga|sonolencia|\bsono\b|bocejo|olhos? fechad|microsono/.test(t)) return null;
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


// ============================================================================
// FADIGA DETECTADA — consistência e matriz (Anexo I, "Eventos de Fadiga")
// ============================================================================

/** Gatilho do detector para veículos rodoviários (PGS-007245, item 7.1: 1,5 s e 10 km/h). */
export const VELOCIDADE_MINIMA_FADIGA_KMH = 10;
/** Detecções do mesmo veículo dentro desta janela formam uma única ocorrência. */
export const JANELA_FADIGA_MIN = 15;

/** Farol de cada ocorrência de fadiga. */
export const CLASSIFICACAO_FADIGA = Object.freeze({
  PARADO: 'VEICULO_PARADO', // abaixo do gatilho: motorista dormindo com o veículo parado; não conta na matriz
  ANALISE: 'EM_ANALISE', // em movimento e isolada: a Central valida pelo vídeo
  CONFIRMADA: 'CONFIRMADA', // em movimento e repetida em até 15 min, ou confirmada pela Central: Crítico N3
  DESCARTADA: 'DESCARTADA', // descartada pela Central (falso positivo, uso como benefício etc.)
});

/** Linhas da matriz de "Eventos de Fadiga" do Anexo I. */
export const LINHAS_MATRIZ_FADIGA = Object.freeze({
  FADIGA_VERDADEIRA: 'FADIGA_VERDADEIRA',
  PRONTIDAO: 'PRONTIDAO',
  SEM_PARADA: 'SEM_PARADA',
});

const COMITE_FADIGA = 'Aplicar Comitê Pela Vida (PNR-000267 – Gestão de Condutas para SSMA)';

/** Texto do Anexo I por linha (e elegibilidade ao teste de Prontidão) e recorrência (1º, 2º, 3º ou mais). */
export const MATRIZ_FADIGA = Object.freeze({
  FADIGA_VERDADEIRA: {
    titulo: 'Evento de fadiga verdadeira classificada e comunicada pela Central',
    elegivel: [
      'Reativação por no mínimo 15 minutos + reteste através da ferramenta Prontidão',
      'Reativação por no mínimo 15 minutos + reteste do Prontidão + encaminhamento à medicina para avaliação de saúde e/ou acolhimento',
      'Reativação por no mínimo 15 minutos + reteste do Prontidão + encaminhamento à medicina para avaliação de saúde e/ou acolhimento',
    ],
    nao_elegivel: [
      'Reativação por no mínimo 15 minutos + conversa formal com o líder',
      'Conversa formal com o líder + encaminhamento à medicina para avaliação de saúde',
      'Conversa formal com o líder + encaminhamento à medicina para avaliação de saúde',
    ],
  },
  PRONTIDAO: {
    titulo: 'Não conformidade no Processo de Prontidão (empregados elegíveis, Anexo IV do PNR-000257)',
    medidas: ['Empregado / gestor: advertência verbal', 'Empregado / gestor: advertência escrita', COMITE_FADIGA],
  },
  SEM_PARADA: {
    titulo: 'Motorista não realizou a parada obrigatória até 15 minutos após a fadiga verdadeira',
    medidas: ['Advertência escrita', 'Suspensão de RAC', COMITE_FADIGA],
  },
});

export const NOTAS_MATRIZ_FADIGA = [
  'Fica a critério do líder e/ou da medicina afastar o empregado das atividades de risco caso seja necessário.',
  'O não atendimento à parada obrigatória após fadiga verdadeira caracteriza risco grave e iminente e exige tratativa rigorosa e imediata.',
];

/**
 * Medida do Anexo I para a linha da matriz de fadiga e a N-ésima ocorrência no mês.
 * Na fadiga verdadeira a medida depende de o empregado ser elegível ao teste de Prontidão.
 */
export function medidaFadiga(linha, ocorrencia, elegivel = true) {
  const item = MATRIZ_FADIGA[linha];
  if (!item) return null;
  const indice = Math.min(Math.max(Number(ocorrencia) || 1, 1), 3) - 1;
  if (linha === LINHAS_MATRIZ_FADIGA.FADIGA_VERDADEIRA) {
    return (elegivel ? item.elegivel : item.nao_elegivel)[indice];
  }
  return item.medidas[indice];
}

export function emMovimentoFadiga(deteccao) {
  return Number(deteccao.valor) >= VELOCIDADE_MINIMA_FADIGA_KMH;
}

/**
 * Agrupa as detecções de "fadiga detectada" em ocorrências e dá o farol de cada uma:
 *  - abaixo de 10 km/h: VEICULO_PARADO (não conta na matriz);
 *  - em movimento: detecções do mesmo veículo a até 15 min uma da outra formam uma ocorrência;
 *    2 ou mais -> CONFIRMADA; 1 só -> EM_ANALISE;
 *  - a validação da Central (validacao_fadiga = CONFIRMADA | DESCARTADA) prevalece.
 * Entrada: eventos { id, tag_placa, motorista, data_hora, valor, validacao_fadiga? }.
 */
export function agruparOcorrenciasFadiga(deteccoes) {
  const ordenadas = [...deteccoes].sort((a, b) =>
    String(a.tag_placa).localeCompare(String(b.tag_placa)) || new Date(a.data_hora) - new Date(b.data_hora));
  const janelaMs = JANELA_FADIGA_MIN * 60 * 1000;
  const grupos = [];
  let atual = null;
  for (const d of ordenadas) {
    const movendo = emMovimentoFadiga(d);
    const ultima = atual?.deteccoes[atual.deteccoes.length - 1];
    if (atual && movendo && atual.movimento && atual.tag_placa === d.tag_placa
      && new Date(d.data_hora) - new Date(ultima.data_hora) <= janelaMs) {
      atual.deteccoes.push(d);
      continue;
    }
    atual = { tag_placa: d.tag_placa, movimento: movendo, deteccoes: [d] };
    grupos.push(atual);
  }
  return grupos
    .map((g) => {
      const automatica = !g.movimento
        ? CLASSIFICACAO_FADIGA.PARADO
        : g.deteccoes.length >= 2 ? CLASSIFICACAO_FADIGA.CONFIRMADA : CLASSIFICACAO_FADIGA.ANALISE;
      // A validação da Central em qualquer detecção vale para a ocorrência toda.
      const manual = g.deteccoes.map((d) => d.validacao_fadiga).find(Boolean) || null;
      const primeira = g.deteccoes[0];
      return {
        chave: primeira.id,
        tag_placa: g.tag_placa,
        motorista: primeira.motorista || null,
        inicio: primeira.data_hora,
        fim: g.deteccoes[g.deteccoes.length - 1].data_hora,
        velocidade_max: Math.max(...g.deteccoes.map((d) => Number(d.valor) || 0)),
        em_movimento: g.movimento,
        classificacao_automatica: automatica,
        classificacao: manual || automatica,
        validada_manualmente: Boolean(manual),
        deteccoes: g.deteccoes,
      };
    })
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
}
