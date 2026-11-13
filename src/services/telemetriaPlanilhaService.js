// ============================================================================
// src/services/telemetriaPlanilhaService.js — Leitura da planilha de telemetria.
//
// Planilha exportada da plataforma de telemetria (colunas: Nome da Origem, Data
// Equipamento, Data GPS, Placa, Cerca, Duração Vel. Excedida - s, Velocidade,
// Limite Km/h, Motorista, Endereço, Google Maps Link, Evento).
//
// A planilha traz tudo o que o rastreador registra (a maior parte são posições a
// cada 2 min). Só os eventos de conduta viram registros; as posições servem para
// apurar se o motorista parou em até 15 min depois de uma fadiga (PGS-007245,
// item 7.3.1). Funções puras: a gravação fica no telemetriaController.
// ============================================================================
import crypto from 'crypto';
import XLSX from 'xlsx';
import * as regras from '../utils/classificacaoTelemetria.js';

const { EVENTOS } = regras;

/** Erro com status HTTP, no formato tratado por src/middleware/error.js. */
export function erroHttp(statusCode, message, error = 'Requisicao invalida') {
  const erro = new Error(message);
  erro.statusCode = statusCode;
  erro.error = error;
  return erro;
}

const MINUTO = 60 * 1000;
/** Janela para o condutor parar depois da fadiga (item 7.3.1). */
const JANELA_PARADA_FADIGA_MS = 15 * MINUTO;
/** Velocidade zerada por este tempo conta como parada (as posições vêm a cada ~2 min). */
const PARADA_MINIMA_MS = 5 * MINUTO;
/** Leitura em movimento até este tempo depois da janela prova que não houve parada. */
const EVIDENCIA_APOS_JANELA_MS = 10 * MINUTO;
/** "Tempo total em velocidade máxima" complementa o excesso registrado até este tempo antes. */
const JANELA_DURACAO_VELOCIDADE_MS = 10 * MINUTO;
/** Fuso da planilha (Pará, sem horário de verão). */
export const FUSO_PADRAO_MIN = -180;

/**
 * Cabeçalhos aceitos por campo (normalizados, sem acento). Valem tanto a exportação
 * da plataforma quanto a planilha modelo do Omega Track (DATA/HORA, TAG/PLACA,
 * MOTORISTA, EVENTO, VALOR REGISTRADO, VELOCIDADE LIMITE, LOCALIZAÇÃO, SEVERIDADE).
 */
const COLUNAS = {
  placa: ['placa', 'tag', 'tag/placa', 'tag placa', 'veiculo'],
  data: ['data equipamento', 'data/hora', 'data hora', 'data_hora', 'data'],
  data_gps: ['data gps'],
  velocidade: ['velocidade', 'valor', 'valor registrado', 'velocidade registrada'],
  limite: ['limite km/h', 'limite', 'limite (km/h)', 'velocidade limite', 'limite de velocidade'],
  motorista: ['motorista', 'condutor'],
  endereco: ['endereco', 'localizacao', 'local'],
  link: ['google maps link', 'link', 'mapa'],
  evento: ['evento', 'descricao do evento'],
  cerca: ['cerca'],
  duracao: ['duracao vel. excedida - s', 'duracao', 'duracao (s)'],
  origem: ['nome da origem', 'origem'],
  severidade: ['severidade', 'severidade informada'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'long', 'lng', 'lon'],
};

/** Severidade informada na planilha (modelo) -> valor gravado; vazio/inválido = calcula pelo Anexo I. */
const SEVERIDADE_INFORMADA = {
  normal: 'NORMAL',
  moderado: 'MODERADO',
  moderada: 'MODERADO',
  media: 'MODERADO',
  grave: 'GRAVE',
  significativo: 'GRAVE',
  significativa: 'GRAVE',
  alta: 'GRAVE',
  critico: 'CRITICO',
  critica: 'CRITICO',
};

export function severidadeInformada(valor) {
  return SEVERIDADE_INFORMADA[regras.normalizar(valor)] || null;
}

const EVENTOS_DE_PARADA = /^(ignicao off|estacionamento|modo sleep)/;

function texto(valor) {
  if (valor === null || valor === undefined) return null;
  const t = String(valor).trim();
  return t && t.toLowerCase() !== 'null' ? t : null;
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const n = Number(String(valor).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Data da planilha → Date (UTC). Aceita o número serial do Excel, "dd/mm/aaaa hh:mm[:ss]"
 * e ISO. Datas sem fuso são lidas no fuso da planilha (padrão -03:00).
 */
function dataDaCelula(valor, fusoMin = FUSO_PADRAO_MIN) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'number') {
    // Serial do Excel: dias desde 30/12/1899 no relógio local; arredonda ao segundo.
    const segundos = Math.round(valor * 86400);
    return new Date(Date.UTC(1899, 11, 30) + segundos * 1000 - fusoMin * MINUTO);
  }
  const t = String(valor).trim();
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, d, m, a, h = '0', min = '0', s = '0'] = br;
    return new Date(Date.UTC(+a, +m - 1, +d, +h, +min, +s) - fusoMin * MINUTO);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const temFuso = /(z|[+-]\d{2}:?\d{2})$/i.test(t);
    const data = new Date(temFuso ? t : `${t.replace(' ', 'T')}Z`);
    if (Number.isNaN(data.getTime())) return null;
    return temFuso ? data : new Date(data.getTime() - fusoMin * MINUTO);
  }
  return null;
}

/** Latitude e longitude do link do Google Maps (…?q=-6.055961,-50.127773). */
/**
 * Coordenadas do evento, na ordem: link do Google Maps, colunas LATITUDE/LONGITUDE,
 * ou LOCALIZAÇÃO escrita como "lat, long" (planilha modelo).
 */
function coordenadasDaLinha(link, latitude, longitude, localizacao) {
  const doLink = coordenadasDoLink(link);
  if (doLink.latitude !== null) return doLink;
  const lat = numero(latitude);
  const lng = numero(longitude);
  if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { latitude: lat, longitude: lng };
  const m = String(localizacao || '').trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  return m ? { latitude: Number(m[1]), longitude: Number(m[2]) } : { latitude: null, longitude: null };
}

function coordenadasDoLink(link) {
  const m = String(link || '').match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  return m ? { latitude: Number(m[1]), longitude: Number(m[2]) } : { latitude: null, longitude: null };
}

/**
 * Placa "limpa" para cruzar com a frota: a plataforma às vezes acrescenta o contrato
 * ("QVN4G02 CT-251"); fica o primeiro trecho no padrão de placa (antigo ou Mercosul).
 */
export function chavePlaca(valor) {
  const limpo = regras.normalizar(valor).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const placa = limpo.match(/[A-Z]{3}[0-9][A-Z0-9][0-9]{2}/);
  return placa ? placa[0] : limpo;
}

function chaveUnica(placa, dataHora, eventoOriginal) {
  return crypto.createHash('sha256').update(`${placa}|${dataHora.toISOString()}|${eventoOriginal}`).digest('hex');
}

/** Índice de cada campo na linha de cabeçalho (null quando a coluna não existe). */
function mapearCabecalho(cabecalho) {
  const normalizados = cabecalho.map((c) => regras.normalizar(c));
  const indices = {};
  for (const [campo, nomes] of Object.entries(COLUNAS)) {
    const i = normalizados.findIndex((n) => nomes.includes(n));
    indices[campo] = i >= 0 ? i : null;
  }
  return indices;
}

/** Lê o arquivo e devolve as linhas da primeira aba que tiver a coluna "Evento". */
function lerLinhas(buffer) {
  let livro;
  try {
    livro = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch (err) {
    throw erroHttp(400, 'Não foi possível ler a planilha. Envie o arquivo .xlsx exportado da plataforma de telemetria.');
  }
  for (const nome of livro.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json(livro.Sheets[nome], { header: 1, defval: null, raw: true, blankrows: false });
    const posCabecalho = linhas.slice(0, 10).findIndex((l) => l.some((c) => regras.normalizar(c) === 'evento'));
    if (posCabecalho < 0) continue;
    const indices = mapearCabecalho(linhas[posCabecalho]);
    if (indices.placa === null || indices.data === null) continue;
    return { aba: nome, indices, linhas: linhas.slice(posCabecalho + 1), deslocamento: posCabecalho + 2 };
  }
  throw erroHttp(400, 'Planilha fora do padrão: são necessárias as colunas "Placa", "Data Equipamento" e "Evento".');
}

/**
 * Decide se o veículo parou em até 15 min depois da fadiga, olhando as leituras seguintes
 * da mesma placa: ignição desligada/estacionamento, ou velocidade zerada por ≥ 5 min
 * começando dentro da janela. Só conclui "não parou" (false) com prova de que o veículo
 * seguia rodando logo depois da janela (leitura com velocidade > 0 até 10 min após ela);
 * sem posições no período (ex.: planilha modelo, sem rastreamento) devolve null.
 */
function parouAposFadiga(leituras, inicio) {
  const fimJanela = inicio + JANELA_PARADA_FADIGA_MS;
  const seguintes = leituras.filter((l) => l.t >= inicio);
  for (let i = 0; i < seguintes.length && seguintes[i].t <= fimJanela; i += 1) {
    const leitura = seguintes[i];
    if (EVENTOS_DE_PARADA.test(leitura.texto)) return true;
    if (leitura.velocidade !== 0) continue;
    for (let j = i; j < seguintes.length && seguintes[j].velocidade === 0; j += 1) {
      if (EVENTOS_DE_PARADA.test(seguintes[j].texto)) return true;
      if (seguintes[j].t - leitura.t >= PARADA_MINIMA_MS) return true;
    }
  }
  const rodandoAposJanela = seguintes.some(
    (l) => l.t >= fimJanela && l.t <= fimJanela + EVIDENCIA_APOS_JANELA_MS && l.velocidade > 0,
  );
  return rodandoAposJanela ? false : null;
}

/**
 * Converte as linhas da planilha em eventos prontos para gravar.
 * Função pura (sem banco), exportada para os testes.
 */
function extrairEventos(
  { indices, linhas, deslocamento = 2 },
  { fusoMin = FUSO_PADRAO_MIN, arquivo = null, veiculosPorPlaca = new Map() } = {},
) {
  const valor = (linha, campo) => (indices[campo] === null ? null : linha[indices[campo]]);
  const leiturasPorPlaca = new Map();
  const candidatos = [];
  const invalidas = [];
  let ignoradas = 0;

  linhas.forEach((linha, i) => {
    const placa = texto(valor(linha, 'placa'));
    const dataHora = dataDaCelula(valor(linha, 'data'), fusoMin) || dataDaCelula(valor(linha, 'data_gps'), fusoMin);
    const eventoOriginal = texto(valor(linha, 'evento'));
    if (!placa || !dataHora) {
      if (eventoOriginal) invalidas.push({ linha: i + deslocamento, motivo: !placa ? 'sem placa' : 'data inválida' });
      return;
    }
    const velocidade = numero(valor(linha, 'velocidade'));
    const leitura = { t: dataHora.getTime(), velocidade, texto: regras.normalizar(eventoOriginal) };
    if (!leiturasPorPlaca.has(placa)) leiturasPorPlaca.set(placa, []);
    leiturasPorPlaca.get(placa).push(leitura);

    const tipo = regras.classificarTexto(eventoOriginal);
    if (!tipo) {
      ignoradas += 1;
      return;
    }
    candidatos.push({ tipo, placa, dataHora, eventoOriginal, velocidade, linha, ordem: i });
  });

  for (const leituras of leiturasPorPlaca.values()) leituras.sort((a, b) => a.t - b.t);
  candidatos.sort((a, b) => (a.placa === b.placa ? a.dataHora - b.dataHora || a.ordem - b.ordem : a.placa < b.placa ? -1 : 1));

  const eventos = [];
  const chaves = new Set();
  const ultimoExcesso = new Map();
  const fadiga = { total: 0, veiculo_parado: 0, sem_parada: 0, indeterminadas: 0 };

  for (const c of candidatos) {
    if (c.tipo.auxiliar === 'DURACAO_VELOCIDADE') {
      const excesso = ultimoExcesso.get(c.placa);
      if (excesso && c.dataHora - excesso.data_hora <= JANELA_DURACAO_VELOCIDADE_MS) {
        excesso.duracao_s = Math.max(excesso.duracao_s || 0, c.tipo.duracao_s);
      } else {
        ignoradas += 1;
      }
      continue;
    }

    const limite = numero(valor(c.linha, 'limite')) ?? regras.limiteDoTexto(c.eventoOriginal);
    // Para velocidade, o limite da cerca escrito no evento prevalece sobre a coluna.
    const limiteFinal = c.tipo.evento === EVENTOS.VELOCIDADE ? regras.limiteDoTexto(c.eventoOriginal) ?? limite : limite;
    const calculada = regras.avaliarEvento(c.tipo.evento, c.velocidade, limiteFinal);
    // A planilha modelo pode trazer a severidade já classificada pela Central: ela prevalece.
    const informada = severidadeInformada(valor(c.linha, 'severidade'));
    const avaliacao = informada
      ? { ...calculada, severidade: informada, classificacao: informada === 'NORMAL' ? null : informada === 'MODERADO' ? 'N5' : 'N3' }
      : calculada;
    const link = texto(valor(c.linha, 'link'));
    const evento = {
      tag_placa: c.placa.slice(0, 60),
      // TAG da frota cruzada pela placa (null quando a placa não está cadastrada).
      tag: veiculosPorPlaca.get(chavePlaca(c.placa))?.tag ?? null,
      motorista: texto(valor(c.linha, 'motorista'))?.slice(0, 255) ?? null,
      data_hora: c.dataHora,
      evento: c.tipo.evento,
      valor: c.velocidade,
      limite: limiteFinal,
      localizacao: texto(valor(c.linha, 'endereco'))?.slice(0, 500) ?? null,
      severidade: avaliacao.severidade,
      classificacao: avaliacao.classificacao,
      percentual_excesso: avaliacao.percentual_excesso,
      duracao_s: c.tipo.duracao_s ?? (numero(valor(c.linha, 'duracao')) !== null ? Math.round(numero(valor(c.linha, 'duracao'))) : null),
      cerca: texto(valor(c.linha, 'cerca'))?.slice(0, 60) ?? null,
      ...coordenadasDaLinha(link, valor(c.linha, 'latitude'), valor(c.linha, 'longitude'), valor(c.linha, 'endereco')),
      link_mapa: link?.slice(0, 500) ?? null,
      evento_original: c.eventoOriginal.slice(0, 500),
      origem: 'IMPORTACAO',
      arquivo_origem: (texto(valor(c.linha, 'origem')) || arquivo)?.slice(0, 255) ?? null,
      chave_unica: chaveUnica(c.placa, c.dataHora, c.eventoOriginal),
    };
    if (chaves.has(evento.chave_unica)) continue;
    chaves.add(evento.chave_unica);
    eventos.push(evento);
    if (evento.evento === EVENTOS.VELOCIDADE) ultimoExcesso.set(c.placa, evento);

    if (evento.evento === EVENTOS.FADIGA) {
      fadiga.total += 1;
      // Com o veículo parado (abaixo do gatilho de 10 km/h) não há parada obrigatória a apurar.
      if (!regras.emMovimentoFadiga(evento)) {
        fadiga.veiculo_parado += 1;
        evento.parou_em_15_min = null;
        continue;
      }
      const parou = parouAposFadiga(leiturasPorPlaca.get(c.placa), c.dataHora.getTime());
      evento.parou_em_15_min = parou;
      if (parou === null) fadiga.indeterminadas += 1;
      if (parou === false) {
        fadiga.sem_parada += 1;
        const dataHora = new Date(c.dataHora.getTime() + JANELA_PARADA_FADIGA_MS);
        const original = `Fadiga sem parada obrigatória em 15 min (apurado das posições; fadiga às ${c.dataHora.toISOString()})`;
        eventos.push({
          ...evento,
          data_hora: dataHora,
          evento: EVENTOS.FADIGA_SEM_PARADA,
          severidade: 'CRITICO',
          classificacao: 'N3',
          valor: null,
          evento_original: original,
          origem: 'DERIVADO',
          parou_em_15_min: false,
          chave_unica: chaveUnica(c.placa, dataHora, original),
        });
      }
    }
  }

  return { eventos, ignoradas, invalidas, fadiga };
}

export function contarPor(lista, campo) {
  return lista.reduce((acc, item) => {
    const chave = item[campo] ?? 'SEM VALOR';
    acc[chave] = (acc[chave] || 0) + 1;
    return acc;
  }, {});
}

export { lerLinhas, extrairEventos, parouAposFadiga, dataDaCelula, coordenadasDoLink, chaveUnica };
