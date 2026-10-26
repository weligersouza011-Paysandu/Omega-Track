// ============================================================================
// src/controllers/residuosController.js — Gestão de Resíduos (EcoGestão).
//
// Sub-módulo ambiental para controle, métricas e destinação de resíduos:
//   POST /api/ecogestao/residuos/importar  (multipart, campo `arquivo`)
//     Aceita .xlsx, .xls e .csv. Lê a planilha com `xlsx`, mapeia colunas flexíveis,
//     converte datas, extrai mes_ano (YYYY/MM), ignora duplicadas exatas e insere
//     em lote via Prisma.
//   GET  /api/ecogestao/residuos?mes_ano=YYYY/MM
//     Lista os resíduos com filtros e resumo estatístico para cards do Dashboard.
//   GET  /api/ecogestao/residuos/meses
//     Lista os meses disponíveis (ordenados desc) com totais agregados.
//   POST /api/ecogestao/residuos
//     Criação manual individual de resíduo.
//   PUT  /api/ecogestao/residuos/:id
//     Atualização manual de resíduo.
//   DELETE /api/ecogestao/residuos/:id
//     Exclusão de resíduo.
//   DELETE /api/ecogestao/residuos/mes/:mes_ano
//     Exclusão em lote de todos os resíduos de um determinado mês.
// ============================================================================
import XLSX from 'xlsx';
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { registrarLogAtividade } from '../services/auditService.js';
import { comRetryConexao } from '../utils/retryBanco.js';

const LIMITE_AVISOS = 50;
const TAMANHO_LOTE_INSERT = 1000;

// Campos obrigatórios mínimos para a linha ser considerada válida
const CAMPOS_OBRIGATORIOS = ['data', 'tipo_residuos', 'destinacao', 'quantidade_kg_l'];

// Cabeçalhos aceitos (normalizados: sem acentos, caixa alta, sem pontuação)
const COLUNAS = {
  data: [
    'DATA',
    'DT',
    'DATA DA GERACAO',
    'DATA GERACAO',
    'DATA DA SAIDA',
    'DATA SAIDA',
    'DATA COLETA',
    'DATA DA COLETA',
    'DATA DO RESIDUO',
    'DATA DESTINACAO',
    'DATA DA DESTINACAO',
    'DATA TRANSACAO',
    'DATA DO MOVIMENTO',
  ],
  tipo_residuos: [
    'TIPO DE RESIDUO',
    'TIPO DE RESIDUOS',
    'TIPO RESIDUO',
    'TIPO RESIDUOS',
    'TIPO DO RESIDUO',
    'TIPO',
    'RESIDUO',
    'RESIDUOS',
    'DESCRICAO DO RESIDUO',
    'DESCRICAO RESIDUO',
    'DESCRICAO',
    'CLASSIFICACAO',
    'ITEM',
  ],
  numero_mtr_mid: [
    'N MTR MID',
    'NO MTR MID',
    'NUMERO MTR MID',
    'N DO MTR MID',
    'MTR MID',
    'MTR/MID',
    'MTR / MID',
    'N MTR',
    'NO MTR',
    'NUMERO MTR',
    'MTR',
    'N MID',
    'NO MID',
    'NUMERO MID',
    'MID',
    'N MANIFESTO',
    'NUMERO DO MANIFESTO',
    'MANIFESTO',
    'CDF',
    'CERTIFICADO',
    'DOCUMENTO',
  ],
  destinacao: [
    'DESTINACAO',
    'DESTINACAO FINAL',
    'DESTINO',
    'DESTINO FINAL',
    'TIPO DE DESTINACAO',
    'TIPO DESTINACAO',
    'LOCAL DESTINACAO',
    'LOCAL DE DESTINACAO',
    'DISPOSICAO',
    'DISPOSICAO FINAL',
    'TRATAMENTO',
  ],
  quantidade_kg_l: [
    'QUANTIDADE KG L',
    'QUANTIDADE KG/L',
    'QUANTIDADE KGL',
    'QUANTIDADE KG OU L',
    'QUANTIDADE',
    'QTD KG L',
    'QTD KG/L',
    'QTD',
    'QUANTIDADE KG',
    'QUANTIDADE L',
    'PESO KG',
    'PESO',
    'VOLUME L',
    'VOLUME',
    'PESO LIQUIDO',
    'TOTAL KG',
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

function formatarMesAno(data) {
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) return '';
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
  return `${ano}/${mes}`;
}

function normalizarMesAno(mes) {
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

function gerarHashResiduo(r) {
  const dtStr = r.data instanceof Date
    ? r.data.toISOString().slice(0, 10)
    : String(r.data).slice(0, 10);
  const tipo = String(r.tipo_residuos || '').trim().toUpperCase();
  const dest = String(r.destinacao || '').trim().toUpperCase();
  const qtd = Number(r.quantidade_kg_l).toFixed(3);
  const mtr = String(r.numero_mtr_mid || '').trim().toUpperCase();
  return `${dtStr}|${tipo}|${dest}|${qtd}|${mtr}`;
}

// ============================================================================
// 1. IMPORTAÇÃO DE PLANILHA (POST /api/ecogestao/residuos/importar)
// ============================================================================
export const importarResiduos = asyncHandler(async (req, res) => {
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

    const tipoBruto = texto(linha[indices.tipo_residuos]);
    if (!tipoBruto) {
      if (avisos.length < LIMITE_AVISOS) {
        avisos.push({ linha: numeroLinha, motivo: 'Tipo de residuo ausente' });
      }
      continue;
    }

    const destinacaoBruto = texto(linha[indices.destinacao]);
    if (!destinacaoBruto) {
      if (avisos.length < LIMITE_AVISOS) {
        avisos.push({ linha: numeroLinha, motivo: 'Destinacao ausente' });
      }
      continue;
    }

    const valorQtd = parseNumero(linha[indices.quantidade_kg_l]);
    if (valorQtd === null || valorQtd < 0) {
      if (avisos.length < LIMITE_AVISOS) {
        avisos.push({ linha: numeroLinha, motivo: `Quantidade invalida: "${texto(linha[indices.quantidade_kg_l])}"` });
      }
      continue;
    }

    const mtrBruto = indices.numero_mtr_mid >= 0 ? texto(linha[indices.numero_mtr_mid]) : '';
    const mes_ano = formatarMesAno(dataObj);
    mesesEncontrados.add(mes_ano);

    linhasValidas.push({
      data: dataObj,
      tipo_residuos: tipoBruto.toUpperCase(),
      numero_mtr_mid: mtrBruto ? mtrBruto.toUpperCase() : null,
      destinacao: destinacaoBruto.toUpperCase(),
      quantidade_kg_l: arredondar(valorQtd, 3),
      mes_ano,
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
    () => prisma.residuo.findMany({
      where: { mes_ano: { in: mesesArray } },
      select: {
        data: true,
        tipo_residuos: true,
        destinacao: true,
        quantidade_kg_l: true,
        numero_mtr_mid: true,
      },
    }),
    3,
    500,
    'residuos:existentes',
  );

  const hashSet = new Set();
  existentes.forEach((r) => hashSet.add(gerarHashResiduo(r)));

  const registrosParaInserir = [];
  let duplicadosIgnorados = 0;

  for (const item of linhasValidas) {
    const hash = gerarHashResiduo(item);
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
        () => prisma.residuo.createMany({ data: lote }),
        3,
        700,
        'residuos:createMany',
      );
      totalInseridos += resultado.count;
    }
  }

  const somatorioQuantidade = arredondar(
    registrosParaInserir.reduce((acc, r) => acc + r.quantidade_kg_l, 0),
    3,
  );

  await registrarLogAtividade(req, {
    acao: 'IMPORTAR_RESIDUOS',
    modulo: 'EcoGestao',
    detalhes: {
      arquivo: req.file.originalname,
      total_lido: matriz.length - indiceCabecalho - 1,
      validos: linhasValidas.length,
      inseridos: totalInseridos,
      duplicados_ignorados: duplicadosIgnorados,
      linhas_invalidas: avisos.length,
      total_quantidade_kg_l: somatorioQuantidade,
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
      total_quantidade_kg_l: somatorioQuantidade,
      meses_afetados: mesesArray.sort().reverse(),
    },
    avisos: avisos.slice(0, LIMITE_AVISOS),
  });
});

// ============================================================================
// 2. LISTAGEM COM RESUMO ESTATÍSTICO (GET /api/ecogestao/residuos)
// ============================================================================
export const listarResiduos = asyncHandler(async (req, res) => {
  const {
    mes_ano,
    mes,
    tipo_residuos,
    destinacao,
    busca,
    pagina = 1,
    limite = 100,
  } = req.query;

  const mesFiltro = normalizarMesAno(mes_ano || mes);

  const where = {};
  if (mesFiltro) {
    where.mes_ano = mesFiltro;
  }
  if (tipo_residuos) {
    where.tipo_residuos = { contains: String(tipo_residuos).trim().toUpperCase(), mode: 'insensitive' };
  }
  if (destinacao) {
    where.destinacao = { equals: String(destinacao).trim().toUpperCase() };
  }
  if (busca) {
    const termo = String(busca).trim();
    where.OR = [
      { tipo_residuos: { contains: termo, mode: 'insensitive' } },
      { destinacao: { contains: termo, mode: 'insensitive' } },
      { numero_mtr_mid: { contains: termo, mode: 'insensitive' } },
    ];
  }

  const pag = Math.max(1, parseInt(pagina, 10) || 1);
  const lim = Math.max(1, Math.min(1000, parseInt(limite, 10) || 100));
  const skip = (pag - 1) * lim;

  // Busca lista paginada e todos os dados para o resumo estatístico do dashboard
  const [totalGeral, itens, todosDoPeriodo] = await comRetryConexao(
    () => Promise.all([
      prisma.residuo.count({ where }),
      prisma.residuo.findMany({
        where,
        orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
        skip,
        take: lim,
      }),
      // Para o resumo do período (cards e gráficos), usamos o filtro de mês/busca
      prisma.residuo.findMany({
        where,
        select: {
          tipo_residuos: true,
          destinacao: true,
          quantidade_kg_l: true,
          numero_mtr_mid: true,
          mes_ano: true,
        },
      }),
    ]),
    3,
    500,
    'residuos:listar',
  );

  // Cálculo das métricas para os Cards do Dashboard
  let totalQuantidade = 0;
  let totalCmd = 0;
  let totalExterno = 0;
  let totalOutros = 0;
  const mapaDestinacao = {};
  const mapaTipo = {};
  let totalMtrs = 0;

  for (const item of todosDoPeriodo) {
    const qtd = Number(item.quantidade_kg_l) || 0;
    totalQuantidade += qtd;

    const dest = item.destinacao ? item.destinacao.toUpperCase() : 'OUTROS';
    if (dest.includes('CMD')) {
      totalCmd += qtd;
    } else if (dest.includes('EXTERNO')) {
      totalExterno += qtd;
    } else {
      totalOutros += qtd;
    }

    if (!mapaDestinacao[dest]) {
      mapaDestinacao[dest] = { destinacao: dest, total: 0, quantidade_registros: 0 };
    }
    mapaDestinacao[dest].total += qtd;
    mapaDestinacao[dest].quantidade_registros += 1;

    const tipo = item.tipo_residuos ? item.tipo_residuos.toUpperCase() : 'OUTROS';
    if (!mapaTipo[tipo]) {
      mapaTipo[tipo] = { tipo, total: 0, quantidade_registros: 0 };
    }
    mapaTipo[tipo].total += qtd;
    mapaTipo[tipo].quantidade_registros += 1;

    if (item.numero_mtr_mid && String(item.numero_mtr_mid).trim() !== '') {
      totalMtrs += 1;
    }
  }

  totalQuantidade = arredondar(totalQuantidade, 2);
  totalCmd = arredondar(totalCmd, 2);
  totalExterno = arredondar(totalExterno, 2);
  totalOutros = arredondar(totalOutros, 2);

  const porDestinacao = Object.values(mapaDestinacao)
    .map((d) => ({
      ...d,
      total: arredondar(d.total, 2),
      percentual: totalQuantidade > 0 ? arredondar((d.total / totalQuantidade) * 100, 1) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const porTipo = Object.values(mapaTipo)
    .map((t) => ({
      ...t,
      total: arredondar(t.total, 2),
      percentual: totalQuantidade > 0 ? arredondar((t.total / totalQuantidade) * 100, 1) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const topResiduos = porTipo.slice(0, 5);

  return res.status(200).json({
    dados: itens,
    resumo: {
      total_registros: totalGeral,
      total_quantidade_kg_l: totalQuantidade,
      total_cmd: totalCmd,
      total_externo: totalExterno,
      total_outros: totalOutros,
      total_mtrs: totalMtrs,
      por_destinacao: porDestinacao,
      por_tipo: porTipo,
      top_residuos: topResiduos,
      mes_ano_selecionado: mesFiltro || null,
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
// 3. MESES DISPONÍVEIS (GET /api/ecogestao/residuos/meses)
// ============================================================================
export const listarMesesResiduos = asyncHandler(async (_req, res) => {
  const grupos = await comRetryConexao(
    () => prisma.residuo.groupBy({
      by: ['mes_ano'],
      _count: { id: true },
      _sum: { quantidade_kg_l: true },
      orderBy: { mes_ano: 'desc' },
    }),
    3,
    500,
    'residuos:meses',
  );

  const meses = grupos.map((g) => ({
    mes_ano: g.mes_ano,
    total_registros: g._count.id,
    total_quantidade_kg_l: arredondar(g._sum.quantidade_kg_l || 0, 2),
  }));

  return res.status(200).json({
    meses,
    total_meses: meses.length,
  });
});

// ============================================================================
// 4. CRUD MANUAL INDIVIDUAL (POST, PUT, DELETE)
// ============================================================================
export const criarResiduo = asyncHandler(async (req, res) => {
  const { data, tipo_residuos, numero_mtr_mid, destinacao, quantidade_kg_l } = req.body;

  const dataObj = parseData(data);
  if (!dataObj) {
    return res.status(400).json({
      error: 'Data invalida',
      message: 'Informe uma data valida no formato YYYY-MM-DD ou DD/MM/YYYY.',
    });
  }

  if (!tipo_residuos || !texto(tipo_residuos)) {
    return res.status(400).json({
      error: 'Tipo de residuo obrigatorio',
      message: 'Informe o tipo de residuo.',
    });
  }

  if (!destinacao || !texto(destinacao)) {
    return res.status(400).json({
      error: 'Destinacao obrigatoria',
      message: 'Informe a destinacao (ex: CMD, EXTERNO).',
    });
  }

  const qtd = parseNumero(quantidade_kg_l);
  if (qtd === null || qtd < 0) {
    return res.status(400).json({
      error: 'Quantidade invalida',
      message: 'A quantidade em KG/L deve ser um numero positivo.',
    });
  }

  const mes_ano = formatarMesAno(dataObj);
  const novo = await comRetryConexao(
    () => prisma.residuo.create({
      data: {
        data: dataObj,
        tipo_residuos: String(tipo_residuos).trim().toUpperCase(),
        numero_mtr_mid: numero_mtr_mid ? String(numero_mtr_mid).trim().toUpperCase() : null,
        destinacao: String(destinacao).trim().toUpperCase(),
        quantidade_kg_l: arredondar(qtd, 3),
        mes_ano,
      },
    }),
    3,
    500,
    'residuos:criar',
  );

  await registrarLogAtividade(req, {
    acao: 'CRIAR_RESIDUO',
    modulo: 'EcoGestao',
    detalhes: { id: novo.id, tipo_residuos: novo.tipo_residuos, quantidade_kg_l: novo.quantidade_kg_l },
  });

  return res.status(201).json({
    sucesso: true,
    mensagem: 'Residuo cadastrado com sucesso.',
    dado: novo,
  });
});

export const atualizarResiduo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { data, tipo_residuos, numero_mtr_mid, destinacao, quantidade_kg_l } = req.body;

  const existente = await prisma.residuo.findUnique({ where: { id } });
  if (!existente) {
    return res.status(404).json({
      error: 'Residuo nao encontrado',
      message: 'Registro de residuo nao localizado.',
    });
  }

  const dadosAtualizacao = {};

  if (data !== undefined) {
    const dataObj = parseData(data);
    if (!dataObj) {
      return res.status(400).json({ error: 'Data invalida' });
    }
    dadosAtualizacao.data = dataObj;
    dadosAtualizacao.mes_ano = formatarMesAno(dataObj);
  }

  if (tipo_residuos !== undefined) {
    dadosAtualizacao.tipo_residuos = String(tipo_residuos).trim().toUpperCase();
  }

  if (numero_mtr_mid !== undefined) {
    dadosAtualizacao.numero_mtr_mid = numero_mtr_mid ? String(numero_mtr_mid).trim().toUpperCase() : null;
  }

  if (destinacao !== undefined) {
    dadosAtualizacao.destinacao = String(destinacao).trim().toUpperCase();
  }

  if (quantidade_kg_l !== undefined) {
    const qtd = parseNumero(quantidade_kg_l);
    if (qtd === null || qtd < 0) {
      return res.status(400).json({ error: 'Quantidade invalida' });
    }
    dadosAtualizacao.quantidade_kg_l = arredondar(qtd, 3);
  }

  const atualizado = await comRetryConexao(
    () => prisma.residuo.update({
      where: { id },
      data: dadosAtualizacao,
    }),
    3,
    500,
    'residuos:atualizar',
  );

  await registrarLogAtividade(req, {
    acao: 'ATUALIZAR_RESIDUO',
    modulo: 'EcoGestao',
    detalhes: { id, alteracoes: dadosAtualizacao },
  });

  return res.status(200).json({
    sucesso: true,
    mensagem: 'Residuo atualizado com sucesso.',
    dado: atualizado,
  });
});

export const excluirResiduo = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existente = await prisma.residuo.findUnique({ where: { id } });
  if (!existente) {
    return res.status(404).json({
      error: 'Residuo nao encontrado',
      message: 'Registro de residuo nao localizado.',
    });
  }

  await comRetryConexao(
    () => prisma.residuo.delete({ where: { id } }),
    3,
    500,
    'residuos:excluir',
  );

  await registrarLogAtividade(req, {
    acao: 'EXCLUIR_RESIDUO',
    modulo: 'EcoGestao',
    detalhes: { id, tipo_residuos: existente.tipo_residuos, quantidade_kg_l: existente.quantidade_kg_l },
  });

  return res.status(200).json({
    sucesso: true,
    mensagem: 'Residuo excluido com sucesso.',
  });
});

export const limparMesResiduos = asyncHandler(async (req, res) => {
  const { mes_ano } = req.params;
  const mesFormatado = normalizarMesAno(mes_ano);

  if (!mesFormatado) {
    return res.status(400).json({
      error: 'Mes invalido',
      message: 'Informe o mes no formato YYYY/MM ou YYYY-MM.',
    });
  }

  const resultado = await comRetryConexao(
    () => prisma.residuo.deleteMany({
      where: { mes_ano: mesFormatado },
    }),
    3,
    500,
    'residuos:limparMes',
  );

  await registrarLogAtividade(req, {
    acao: 'LIMPAR_MES_RESIDUOS',
    modulo: 'EcoGestao',
    detalhes: { mes_ano: mesFormatado, registros_excluidos: resultado.count },
  });

  return res.status(200).json({
    sucesso: true,
    mensagem: `Foram excluidos ${resultado.count} registro(s) do mes ${mesFormatado}.`,
    excluidos: resultado.count,
  });
});
