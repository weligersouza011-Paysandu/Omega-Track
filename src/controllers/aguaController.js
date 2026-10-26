// ============================================================================
// src/controllers/aguaController.js — Consumo de Água Potável (EcoGestão).
//
// Sub-módulo ambiental para monitoramento de captação e consumo de água potável:
//   POST /api/ecogestao/agua/importar  (multipart, campo `arquivo`)
//     Aceita .xlsx, .xls e .csv. Lê a planilha com `xlsx`, mapeia colunas flexíveis,
//     converte datas, extrai ano_mes (YYYY/MM), ignora duplicadas exatas e insere
//     em lote via Prisma.
//   GET  /api/ecogestao/agua?ano_mes=YYYY/MM
//     Lista os registros de consumo com filtros e resumo estatístico para o Dashboard
//     (total m³, média diária, pico, distribuição por ponto de captação).
//   GET  /api/ecogestao/agua/meses
//     Lista os meses disponíveis (ordenados desc) com totais agregados.
//   POST /api/ecogestao/agua
//     Criação manual individual de registro de consumo de água.
//   PUT  /api/ecogestao/agua/:id
//     Atualização manual de registro existente.
//   DELETE /api/ecogestao/agua/:id
//     Exclusão de registro.
//   DELETE /api/ecogestao/agua/mes/:ano_mes
//     Exclusão em lote de todos os registros de um mês.
// ============================================================================
import XLSX from 'xlsx';
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { registrarLogAtividade } from '../services/auditService.js';
import { comRetryConexao } from '../utils/retryBanco.js';

const LIMITE_AVISOS = 50;
const TAMANHO_LOTE_INSERT = 1000;

// Campos obrigatórios mínimos
const CAMPOS_OBRIGATORIOS = ['data', 'pontos_captacao', 'consumo_m3'];

// Cabeçalhos flexíveis aceitos
const COLUNAS = {
  data: [
    'DATA',
    'DT',
    'DATA DA MEDICAO',
    'DATA MEDICAO',
    'DATA DA LEITURA',
    'DATA LEITURA',
    'DATA DO CONSUMO',
    'DATA CONSUMO',
    'DATA TRANSACAO',
    'DIA',
  ],
  pontos_captacao: [
    'PONTOS DE CAPTACAO',
    'PONTO DE CAPTACAO',
    'PONTOS DE CAPTACAO DE AGUA',
    'PONTO DE CAPTACAO DE AGUA',
    'PONTO CAPTACAO',
    'PONTOS CAPTACAO',
    'LOCAL DE CAPTACAO',
    'LOCAL CAPTACAO',
    'PONTOS',
    'PONTO',
    'CAPTACAO',
    'ORIGEM',
    'FONTE',
    'LOCAL',
    'ETA',
    'HIDROMETRO',
    'DESCRICAO DO PONTO',
  ],
  consumo_m3: [
    'CONSUMO M3',
    'CONSUMO (M3)',
    'CONSUMO (M³)',
    'CONSUMO M³',
    'CONSUMO',
    'VOLUME M3',
    'VOLUME (M3)',
    'VOLUME (M³)',
    'VOLUME M³',
    'VOLUME',
    'M3',
    'M³',
    'QUANTIDADE M3',
    'QUANTIDADE (M3)',
    'QTD M3',
    'TOTAL M3',
  ],
};

function texto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/\s+/g, ' ').trim();
}

function normalizar(valor) {
  return texto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function chaveCabecalho(valor) {
  return normalizar(valor).replace(/[^A-Z0-9]+/g, ' ').trim();
}

function arredondar(valor, casas = 3) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  const fator = 10 ** casas;
  return Math.round(numero * fator) / fator;
}

function mapearColunas(cabecalho = []) {
  const mapa = new Map();
  cabecalho.forEach((celula, indice) => {
    const chave = chaveCabecalho(celula);
    if (chave && !mapa.has(chave)) mapa.set(chave, indice);
  });

  const indices = {};
  for (const [campo, aliases] of Object.entries(COLUNAS)) {
    indices[campo] = -1;
    for (const alias of aliases) {
      const indice = mapa.get(chaveCabecalho(alias));
      if (indice !== undefined) {
        indices[campo] = indice;
        break;
      }
    }
  }
  return indices;
}

function localizarCabecalho(linhas) {
  const limite = Math.min(linhas.length, 30);
  let melhorIndice = 0;
  let melhorPontuacao = -1;

  for (let i = 0; i < limite; i += 1) {
    const indices = mapearColunas(linhas[i] || []);
    const pontuacao = CAMPOS_OBRIGATORIOS.filter((campo) => indices[campo] >= 0).length;
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhorIndice = i;
    }
    if (pontuacao === CAMPOS_OBRIGATORIOS.length) break;
  }
  return melhorIndice;
}

function parseNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (valor === null || valor === undefined) return null;

  let bruto = texto(valor).replace(/\s/g, '');
  if (!bruto) return null;
  bruto = bruto.replace(/[^\d,.-]/g, '');
  if (!bruto || bruto === '-' || bruto === '.' || bruto === ',') return null;

  const temVirgula = bruto.includes(',');
  const temPonto = bruto.includes('.');

  if (temVirgula && temPonto) {
    if (bruto.lastIndexOf(',') > bruto.lastIndexOf('.')) {
      bruto = bruto.replace(/\./g, '').replace(/,/g, '.');
    } else {
      bruto = bruto.replace(/,/g, '');
    }
  } else if (temVirgula) {
    const partes = bruto.split(',');
    bruto = partes.length > 2 ? partes.join('') : bruto.replace(',', '.');
  } else if (temPonto) {
    const partes = bruto.split('.');
    if (partes.length > 2) bruto = partes.join('');
  }

  const numero = Number(bruto);
  return Number.isFinite(numero) ? numero : null;
}

function dataUTC(ano, mes, dia, hora = 0, minuto = 0, segundo = 0) {
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2100) return null;
  const data = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto, segundo));
  if (
    data.getUTCFullYear() !== ano
    || data.getUTCMonth() !== mes - 1
    || data.getUTCDate() !== dia
  ) {
    return null;
  }
  return data;
}

function parseData(valor) {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    const ano = valor.getFullYear();
    const mes = valor.getMonth() + 1;
    const dia = valor.getDate();
    return dataUTC(ano, mes, dia);
  }

  if (typeof valor === 'number' && Number.isFinite(valor)) {
    const partes = XLSX.SSF.parse_date_code(valor);
    if (!partes) return null;
    return dataUTC(partes.y, partes.m, partes.d);
  }

  const bruto = texto(valor);
  if (!bruto) return null;

  // DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
  let match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(bruto);
  if (match) {
    return dataUTC(Number(match[3]), Number(match[2]), Number(match[1]));
  }

  // YYYY-MM-DD ou YYYY/MM/DD
  match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(bruto);
  if (match) {
    return dataUTC(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  const data = new Date(bruto);
  return Number.isNaN(data.getTime()) ? null : data;
}

function formatarAnoMes(data) {
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) return '';
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
  return `${ano}/${mes}`;
}

function normalizarAnoMes(mes) {
  if (!mes) return null;
  const limpo = String(mes).trim();
  if (/^\d{4}\/\d{2}$/.test(limpo)) return limpo;
  if (/^\d{4}-\d{2}$/.test(limpo)) return limpo.replace('-', '/');
  return null;
}

function decodificarCsv(buffer) {
  const bytes = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF
    ? buffer.subarray(3)
    : buffer;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function lerPlanilha(arquivo) {
  const nome = String(arquivo.originalname || '').toLowerCase();
  const opcoes = { type: 'buffer', raw: true };

  if (nome.endsWith('.csv')) {
    const conteudo = decodificarCsv(arquivo.buffer);
    const amostra = conteudo.split(/\r?\n/).slice(0, 10).join('\n');
    const pontosEVirgulas = (amostra.match(/;/g) || []).length;
    const virgulas = (amostra.match(/,/g) || []).length;
    const tabs = (amostra.match(/\t/g) || []).length;
    const separador = tabs > pontosEVirgulas && tabs > virgulas
      ? '\t'
      : (pontosEVirgulas > virgulas ? ';' : ',');
    return XLSX.read(conteudo, { type: 'string', raw: true, FS: separador });
  }

  return XLSX.read(arquivo.buffer, opcoes);
}

function escolherAba(workbook) {
  for (const nomeAba of workbook.SheetNames) {
    const sheet = workbook.Sheets[nomeAba];
    if (!sheet || !sheet['!ref']) continue;
    const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const idx = localizarCabecalho(linhas);
    const indices = mapearColunas(linhas[idx] || []);
    if (CAMPOS_OBRIGATORIOS.every((c) => indices[c] >= 0)) {
      return nomeAba;
    }
  }
  return workbook.SheetNames[0];
}

function gerarHashConsumoAgua(item) {
  const dtStr = item.data instanceof Date
    ? item.data.toISOString().slice(0, 10)
    : String(item.data).slice(0, 10);
  const ponto = String(item.pontos_captacao || '').trim().toUpperCase();
  const consumo = Number(item.consumo_m3).toFixed(3);
  return `${dtStr}|${ponto}|${consumo}`;
}

// ============================================================================
// 1. IMPORTAÇÃO DE PLANILHA (POST /api/ecogestao/agua/importar)
// ============================================================================
export const importarConsumoAgua = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({
      error: 'Arquivo ausente',
      message: 'Envie um arquivo .xlsx, .xls ou .csv no campo "arquivo".',
    });
  }

  let workbook;
  try {
    workbook = lerPlanilha(req.file);
  } catch (erro) {
    return res.status(400).json({
      error: 'Falha ao ler arquivo',
      message: 'Nao foi possivel interpretar a planilha. Verifique a extensao e a codificacao do arquivo.',
      detalhes: erro.message,
    });
  }

  if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
    return res.status(400).json({
      error: 'Planilha vazia',
      message: 'O arquivo enviado nao possui planilhas validas.',
    });
  }

  const nomeAba = escolherAba(workbook);
  const sheet = workbook.Sheets[nomeAba];
  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  if (!matriz || matriz.length < 2) {
    return res.status(400).json({
      error: 'Dados insuficientes',
      message: 'A planilha selecionada esta vazia ou nao contem dados alem do cabecalho.',
    });
  }

  const indiceCabecalho = localizarCabecalho(matriz);
  const cabecalhoLinha = matriz[indiceCabecalho] || [];
  const indices = mapearColunas(cabecalhoLinha);

  const colunasFaltantes = CAMPOS_OBRIGATORIOS.filter((campo) => indices[campo] < 0);
  if (colunasFaltantes.length > 0) {
    return res.status(400).json({
      error: 'Cabecalho invalido',
      message: `As seguintes colunas obrigatorias nao foram encontradas: ${colunasFaltantes.join(', ')}.`,
      cabecalho_encontrado: cabecalhoLinha.filter(Boolean),
    });
  }

  const linhasValidas = [];
  const avisos = [];
  const mesesEncontrados = new Set();
  const agora = new Date();

  for (let i = indiceCabecalho + 1; i < matriz.length; i += 1) {
    const linha = matriz[i];
    if (!Array.isArray(linha) || linha.every((c) => texto(c) === '')) continue;

    const numeroLinha = i + 1;
    const valorData = linha[indices.data];
    const dataObj = parseData(valorData);
    if (!dataObj) {
      if (avisos.length < LIMITE_AVISOS) {
        avisos.push({ linha: numeroLinha, motivo: `Data invalida ou nao reconhecida: "${texto(valorData)}"` });
      }
      continue;
    }

    const pontoBruto = texto(linha[indices.pontos_captacao]);
    if (!pontoBruto) {
      if (avisos.length < LIMITE_AVISOS) {
        avisos.push({ linha: numeroLinha, motivo: 'Ponto de captacao ausente' });
      }
      continue;
    }

    const valorConsumo = parseNumero(linha[indices.consumo_m3]);
    if (valorConsumo === null || valorConsumo < 0) {
      if (avisos.length < LIMITE_AVISOS) {
        avisos.push({ linha: numeroLinha, motivo: `Volume de consumo invalido: "${texto(linha[indices.consumo_m3])}"` });
      }
      continue;
    }

    const ano_mes = formatarAnoMes(dataObj);
    mesesEncontrados.add(ano_mes);

    linhasValidas.push({
      data: dataObj,
      pontos_captacao: pontoBruto.toUpperCase(),
      consumo_m3: arredondar(valorConsumo, 3),
      ano_mes,
      ultima_atualizacao: agora,
    });
  }

  if (linhasValidas.length === 0) {
    return res.status(400).json({
      error: 'Nenhum registro valido',
      message: 'Nenhuma linha valida foi encontrada para importacao.',
      avisos,
    });
  }

  // Deduplicação: busca registros já existentes no banco para os meses presentes na planilha
  const mesesArray = Array.from(mesesEncontrados);
  const existentes = await comRetryConexao(
    () => prisma.consumoAgua.findMany({
      where: { ano_mes: { in: mesesArray } },
      select: {
        data: true,
        pontos_captacao: true,
        consumo_m3: true,
      },
    }),
    3,
    500,
    'consumo_agua:existentes',
  );

  const hashSet = new Set();
  existentes.forEach((r) => hashSet.add(gerarHashConsumoAgua(r)));

  const registrosParaInserir = [];
  let duplicadosIgnorados = 0;

  for (const item of linhasValidas) {
    const hash = gerarHashConsumoAgua(item);
    if (hashSet.has(hash)) {
      duplicadosIgnorados += 1;
      continue;
    }
    hashSet.add(hash);
    registrosParaInserir.push(item);
  }

  let totalInseridos = 0;
  if (registrosParaInserir.length > 0) {
    for (let pos = 0; pos < registrosParaInserir.length; pos += TAMANHO_LOTE_INSERT) {
      const lote = registrosParaInserir.slice(pos, pos + TAMANHO_LOTE_INSERT);
      const resultado = await comRetryConexao(
        () => prisma.consumoAgua.createMany({ data: lote }),
        3,
        700,
        'consumo_agua:createMany',
      );
      totalInseridos += resultado.count;
    }
  }

  const somatorioConsumo = arredondar(
    registrosParaInserir.reduce((acc, r) => acc + r.consumo_m3, 0),
    3,
  );

  await registrarLogAtividade(req, {
    acao: 'IMPORTAR_CONSUMO_AGUA',
    modulo: 'EcoGestao',
    detalhes: {
      arquivo: req.file.originalname,
      total_lido: matriz.length - indiceCabecalho - 1,
      validos: linhasValidas.length,
      inseridos: totalInseridos,
      duplicados_ignorados: duplicadosIgnorados,
      linhas_invalidas: avisos.length,
      total_consumo_m3: somatorioConsumo,
      meses_afetados: mesesArray,
    },
  });

  return res.status(200).json({
    sucesso: true,
    mensagem: `Importacao concluida: ${totalInseridos} registro(s) inserido(s) com sucesso.`,
    resumo: {
      total_linhas_planilha: matriz.length - indiceCabecalho - 1,
      importados: totalInseridos,
      duplicados_ignorados: duplicadosIgnorados,
      linhas_invalidas: avisos.length,
      total_consumo_m3: somatorioConsumo,
      meses_afetados: mesesArray.sort().reverse(),
    },
    avisos: avisos.slice(0, LIMITE_AVISOS),
  });
});

// ============================================================================
// 2. LISTAGEM COM RESUMO ESTATÍSTICO (GET /api/ecogestao/agua)
// ============================================================================
export const listarConsumoAgua = asyncHandler(async (req, res) => {
  const {
    ano_mes,
    mes_ano,
    mes,
    ponto_captacao,
    pontos_captacao,
    busca,
    pagina = 1,
    limite = 100,
  } = req.query;

  const mesFiltro = normalizarAnoMes(ano_mes || mes_ano || mes);
  const pontoFiltro = ponto_captacao || pontos_captacao;

  const where = {};
  if (mesFiltro) {
    where.ano_mes = mesFiltro;
  }
  if (pontoFiltro) {
    where.pontos_captacao = { contains: String(pontoFiltro).trim().toUpperCase(), mode: 'insensitive' };
  }
  if (busca) {
    const termo = String(busca).trim();
    where.OR = [
      { pontos_captacao: { contains: termo, mode: 'insensitive' } },
    ];
  }

  const pag = Math.max(1, parseInt(pagina, 10) || 1);
  const lim = Math.max(1, Math.min(1000, parseInt(limite, 10) || 100));
  const skip = (pag - 1) * lim;

  // Consulta paginada e consulta agregada para os cards do dashboard
  const [totalGeral, itens, todosDoPeriodo] = await comRetryConexao(
    () => Promise.all([
      prisma.consumoAgua.count({ where }),
      prisma.consumoAgua.findMany({
        where,
        orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
        skip,
        take: lim,
      }),
      prisma.consumoAgua.findMany({
        where,
        select: {
          id: true,
          data: true,
          pontos_captacao: true,
          consumo_m3: true,
          ano_mes: true,
        },
        orderBy: { data: 'asc' },
      }),
    ]),
    3,
    500,
    'consumo_agua:listar',
  );

  // Cálculos estatísticos para os Cards e Gráficos
  let totalConsumo = 0;
  let picoConsumo = 0;
  let pontoPico = '';
  let dataPico = null;
  let menorConsumo = Infinity;

  const mapaPontos = {};
  const mapaDias = {};

  for (const item of todosDoPeriodo) {
    const vol = Number(item.consumo_m3) || 0;
    totalConsumo += vol;

    if (vol > picoConsumo) {
      picoConsumo = vol;
      pontoPico = item.pontos_captacao;
      dataPico = item.data;
    }

    if (vol < menorConsumo && vol > 0) {
      menorConsumo = vol;
    }

    // Agrupamento por Ponto de Captação
    const ponto = item.pontos_captacao ? item.pontos_captacao.toUpperCase() : 'OUTROS';
    if (!mapaPontos[ponto]) {
      mapaPontos[ponto] = { ponto, total_m3: 0, registros: 0 };
    }
    mapaPontos[ponto].total_m3 += vol;
    mapaPontos[ponto].registros += 1;

    // Agrupamento diário para evolução cronológica
    const dtISO = item.data instanceof Date
      ? item.data.toISOString().slice(0, 10)
      : String(item.data).slice(0, 10);
    mapaDias[dtISO] = (mapaDias[dtISO] || 0) + vol;
  }

  const diasComConsumo = Object.keys(mapaDias).length;
  const mediaDiaria = diasComConsumo > 0 ? totalConsumo / diasComConsumo : 0;

  totalConsumo = arredondar(totalConsumo, 2);
  picoConsumo = arredondar(picoConsumo, 2);
  menorConsumo = menorConsumo === Infinity ? 0 : arredondar(menorConsumo, 2);

  const distribuicaoPontos = Object.values(mapaPontos)
    .map((p) => ({
      ...p,
      total_m3: arredondar(p.total_m3, 2),
      percentual: totalConsumo > 0 ? arredondar((p.total_m3 / totalConsumo) * 100, 1) : 0,
    }))
    .sort((a, b) => b.total_m3 - a.total_m3);

  const consumoDiario = Object.entries(mapaDias)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dt, vol]) => ({
      data: dt,
      consumo_m3: arredondar(vol, 2),
    }));

  return res.status(200).json({
    dados: itens,
    resumo: {
      total_registros: totalGeral,
      total_consumo_m3: totalConsumo,
      media_diaria_m3: arredondar(mediaDiaria, 2),
      pico_consumo_m3: picoConsumo,
      ponto_pico: pontoPico || null,
      data_pico: dataPico || null,
      menor_consumo_m3: menorConsumo,
      dias_monitorados: diasComConsumo,
      distribuicao_por_ponto: distribuicaoPontos,
      consumo_diario: consumoDiario,
      ano_mes_selecionado: mesFiltro || null,
    },
    paginacao: {
      total: totalGeral,
      pagina: pag,
      limite: lim,
      total_paginas: Math.ceil(totalGeral / lim) || 1,
    },
  });
});

// ============================================================================
// 3. MESES DISPONÍVEIS (GET /api/ecogestao/agua/meses)
// ============================================================================
export const listarMesesAgua = asyncHandler(async (_req, res) => {
  const grupos = await comRetryConexao(
    () => prisma.consumoAgua.groupBy({
      by: ['ano_mes'],
      _count: { id: true },
      _sum: { consumo_m3: true },
      orderBy: { ano_mes: 'desc' },
    }),
    3,
    500,
    'consumo_agua:meses',
  );

  const meses = grupos.map((g) => ({
    ano_mes: g.ano_mes,
    total_registros: g._count.id,
    total_consumo_m3: arredondar(g._sum.consumo_m3 || 0, 2),
  }));

  return res.status(200).json({
    meses,
    total_meses: meses.length,
  });
});

// ============================================================================
// 4. CRUD MANUAL INDIVIDUAL (POST, PUT, DELETE)
// ============================================================================
export const criarConsumoAgua = asyncHandler(async (req, res) => {
  const { data, pontos_captacao, consumo_m3 } = req.body;

  const dataObj = parseData(data);
  if (!dataObj) {
    return res.status(400).json({
      error: 'Data invalida',
      message: 'Informe uma data valida no formato YYYY-MM-DD ou DD/MM/YYYY.',
    });
  }

  if (!pontos_captacao || !texto(pontos_captacao)) {
    return res.status(400).json({
      error: 'Ponto de captacao obrigatorio',
      message: 'Informe o ponto de captacao (ex: ETA, ETA/HIDROMETRO).',
    });
  }

  const vol = parseNumero(consumo_m3);
  if (vol === null || vol < 0) {
    return res.status(400).json({
      error: 'Volume invalido',
      message: 'O consumo em m³ deve ser um numero positivo.',
    });
  }

  const ano_mes = formatarAnoMes(dataObj);
  const agora = new Date();

  const novo = await comRetryConexao(
    () => prisma.consumoAgua.create({
      data: {
        data: dataObj,
        pontos_captacao: String(pontos_captacao).trim().toUpperCase(),
        consumo_m3: arredondar(vol, 3),
        ano_mes,
        ultima_atualizacao: agora,
      },
    }),
    3,
    500,
    'consumo_agua:criar',
  );

  await registrarLogAtividade(req, {
    acao: 'CRIAR_CONSUMO_AGUA',
    modulo: 'EcoGestao',
    detalhes: { id: novo.id, pontos_captacao: novo.pontos_captacao, consumo_m3: novo.consumo_m3 },
  });

  return res.status(201).json({
    sucesso: true,
    mensagem: 'Registro de consumo de agua cadastrado com sucesso.',
    dado: novo,
  });
});

export const atualizarConsumoAgua = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { data, pontos_captacao, consumo_m3 } = req.body;

  const existente = await prisma.consumoAgua.findUnique({ where: { id } });
  if (!existente) {
    return res.status(404).json({
      error: 'Registro nao encontrado',
      message: 'Registro de consumo de agua nao localizado.',
    });
  }

  const dadosAtualizacao = {
    ultima_atualizacao: new Date(),
  };

  if (data !== undefined) {
    const dataObj = parseData(data);
    if (!dataObj) {
      return res.status(400).json({ error: 'Data invalida' });
    }
    dadosAtualizacao.data = dataObj;
    dadosAtualizacao.ano_mes = formatarAnoMes(dataObj);
  }

  if (pontos_captacao !== undefined) {
    dadosAtualizacao.pontos_captacao = String(pontos_captacao).trim().toUpperCase();
  }

  if (consumo_m3 !== undefined) {
    const vol = parseNumero(consumo_m3);
    if (vol === null || vol < 0) {
      return res.status(400).json({ error: 'Volume invalido' });
    }
    dadosAtualizacao.consumo_m3 = arredondar(vol, 3);
  }

  const atualizado = await comRetryConexao(
    () => prisma.consumoAgua.update({
      where: { id },
      data: dadosAtualizacao,
    }),
    3,
    500,
    'consumo_agua:atualizar',
  );

  await registrarLogAtividade(req, {
    acao: 'ATUALIZAR_CONSUMO_AGUA',
    modulo: 'EcoGestao',
    detalhes: { id, alteracoes: dadosAtualizacao },
  });

  return res.status(200).json({
    sucesso: true,
    mensagem: 'Registro atualizado com sucesso.',
    dado: atualizado,
  });
});

export const excluirConsumoAgua = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existente = await prisma.consumoAgua.findUnique({ where: { id } });
  if (!existente) {
    return res.status(404).json({
      error: 'Registro nao encontrado',
      message: 'Registro de consumo de agua nao localizado.',
    });
  }

  await comRetryConexao(
    () => prisma.consumoAgua.delete({ where: { id } }),
    3,
    500,
    'consumo_agua:excluir',
  );

  await registrarLogAtividade(req, {
    acao: 'EXCLUIR_CONSUMO_AGUA',
    modulo: 'EcoGestao',
    detalhes: { id, pontos_captacao: existente.pontos_captacao, consumo_m3: existente.consumo_m3 },
  });

  return res.status(200).json({
    sucesso: true,
    mensagem: 'Registro excluido com sucesso.',
  });
});

export const limparMesAgua = asyncHandler(async (req, res) => {
  const { ano_mes } = req.params;
  const mesFormatado = normalizarAnoMes(ano_mes);

  if (!mesFormatado) {
    return res.status(400).json({
      error: 'Mes invalido',
      message: 'Informe o mes no formato YYYY/MM ou YYYY-MM.',
    });
  }

  const resultado = await comRetryConexao(
    () => prisma.consumoAgua.deleteMany({
      where: { ano_mes: mesFormatado },
    }),
    3,
    500,
    'consumo_agua:limparMes',
  );

  await registrarLogAtividade(req, {
    acao: 'LIMPAR_MES_AGUA',
    modulo: 'EcoGestao',
    detalhes: { ano_mes: mesFormatado, registros_excluidos: resultado.count },
  });

  return res.status(200).json({
    sucesso: true,
    mensagem: `Foram excluidos ${resultado.count} registro(s) do mes ${mesFormatado}.`,
    excluidos: resultado.count,
  });
});

// ============================================================================
// 5. EXCLUSÃO EM LOTE (POST /api/ecogestao/agua/excluir-lote)
// ============================================================================
export const excluirConsumoAguaLote = asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({
      error: 'IDs inválidos',
      message: 'Envie um array "ids" com ao menos um ID para exclusão em lote.',
    });
  }

  const idsValidos = ids.map(String).filter(Boolean);
  const resultado = await comRetryConexao(
    () => prisma.consumoAgua.deleteMany({
      where: { id: { in: idsValidos } },
    }),
    3,
    500,
    'consumo_agua:excluirLote',
  );

  await registrarLogAtividade(req, {
    acao: 'EXCLUIR_CONSUMO_AGUA_LOTE',
    modulo: 'EcoGestao',
    detalhes: { total_solicitado: idsValidos.length, total_excluido: resultado.count },
  }).catch(() => {});

  return res.status(200).json({
    sucesso: true,
    total_excluido: resultado.count,
    mensagem: `${resultado.count} ${resultado.count === 1 ? 'registro excluído' : 'registros excluídos'} com sucesso.`,
  });
});
