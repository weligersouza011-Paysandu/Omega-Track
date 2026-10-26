// ============================================================================
// src/controllers/produtosQuimicosController.js — Tratamento de Produtos Químicos (EcoGestão).
//
// Sub-módulo para controle, matriz de perigocidade e FISPQ/FDS de produtos químicos:
//   POST /api/ecogestao/produtos-quimicos/importar (multipart, campo `arquivo`)
//     Aceita .xlsx, .xls e .csv. Lê a planilha, mapeia colunas flexíveis,
//     converte flags booleanas da matriz de perigos, deduplica e insere em lote.
//   GET  /api/ecogestao/produtos-quimicos
//     Lista os produtos químicos com filtros (enquadramento, local, perigo, busca)
//     e resumo estatístico para o Dashboard (KPIs, matriz de perigos, agrupamentos).
//   POST /api/ecogestao/produtos-quimicos
//     Cadastro manual de produto químico.
//   PUT  /api/ecogestao/produtos-quimicos/:id
//     Edição e atualização da matriz de perigos.
//   DELETE /api/ecogestao/produtos-quimicos/:id
//     Exclusão de produto químico.
// ============================================================================
import XLSX from 'xlsx';
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { registrarLogAtividade } from '../services/auditService.js';
import { comRetryConexao } from '../utils/retryBanco.js';

const LIMITE_AVISOS = 50;
const TAMANHO_LOTE_INSERT = 1000;

// Colunas aceitas para mapeamento flexível de planilhas
const COLUNAS = {
  nome_produto: [
    'NOME DO PRODUTO QUIMICO',
    'NOME DO PRODUTO QUÍMICO',
    'NOME DO PRODUTO',
    'NOME PRODUTO',
    'PRODUTO QUIMICO',
    'PRODUTO QUÍMICO',
    'PRODUTO',
    'NOME',
    'DESCRICAO DO PRODUTO',
    'DESCRICAO',
  ],
  fds_fispq: [
    'FDS / FISPQ',
    'FDS/FISPQ',
    'FDS FISPQ',
    'FDS',
    'FISPQ',
    'FICHA DE SEGURANCA',
    'FICHA',
    'STATUS FISPQ',
  ],
  marca_produto: [
    'MARCA DO PRODUTO',
    'MARCA',
    'FABRICANTE',
    'FORNECEDOR',
    'EMPRESA',
  ],
  substancias_composicao: [
    'SUBSTANCIAS DA COMPOSICAO',
    'SUBSTÂNCIAS DA COMPOSIÇÃO',
    'SUBSTANCIAS COMPOSICAO',
    'SUBSTANCIAS',
    'SUBSTÂNCIAS',
    'COMPOSICAO',
    'COMPOSIÇÃO',
    'FORMULA',
    'PRINCIPIO ATIVO',
  ],
  enquadramento_produto: [
    'ENQUADRAMENTO DO PRODUTO',
    'ENQUADRAMENTO',
    'CLASSIFICACAO DO PRODUTO',
    'CLASSIFICACAO',
    'CLASSIFICAÇÃO',
    'CATEGORIA',
    'TIPO ENQUADRAMENTO',
  ],
  validade_produto: [
    'VALIDADE DO PRODUTO',
    'VALIDADE',
    'DATA DE VALIDADE',
    'DT VALIDADE',
    'VENCIMENTO',
    'DATA DE VENCIMENTO',
    'PRAZO',
  ],
  local_armazenamento: [
    'LOCAL DE ARMAZENAMENTO',
    'LOCAL ARMAZENAMENTO',
    'LOCAL',
    'ARMAZENAMENTO',
    'DEPOSITO',
    'ALMOXARIFADO',
    'SETOR',
  ],
  // Matriz de Perigos (Flags)
  inflamavel: [
    'INFLAMAVEL?',
    'INFLAMÁVEL?',
    'INFLAMAVEL',
    'INFLAMÁVEL',
    'PRODUTO INFLAMAVEL',
  ],
  piroforico: [
    'PIROFORICO?',
    'PIROFÓRICO?',
    'PIROFORICO',
    'PIROFÓRICO',
  ],
  explosivo: [
    'EXPLOSIVO?',
    'EXPLOSIVO',
    'PRODUTO EXPLOSIVO',
  ],
  oxidante: [
    'OXIDANTE?',
    'OXIDANTE',
    'COMBURENTE',
  ],
  corrosivo: [
    'CORROSIVO?',
    'CORROSIVO',
    'PRODUTO CORROSIVO',
  ],
  toxico: [
    'O PRODUTO E TOXICO?',
    'O PRODUTO É TÓXICO?',
    'PRODUTO E TOXICO?',
    'PRODUTO TOXICO',
    'PRODUTO TÓXICO',
    'TOXICO?',
    'TÓXICO?',
    'TOXICO',
    'TÓXICO',
  ],
  radioativo: [
    'O PRODUTO E RADIOATIVO?',
    'O PRODUTO É RADIOATIVO?',
    'PRODUTO E RADIOATIVO?',
    'PRODUTO RADIOATIVO',
    'RADIOATIVO?',
    'RADIOATIVO',
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

// ============================================================================
// 1. PARSER INTELIGENTE DE BOOLEANO / PERIGOS
// ============================================================================
export function parseBooleano(valor) {
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return valor === 1;
  const str = normalizar(valor);
  if (!str) return false;
  return ['SIM', 'S', 'TRUE', '1', 'OK', 'X', 'VERDADEIRO', 'POSITIVO', 'V'].includes(str);
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
    // nome_produto é o principal campo identificador
    let pontuacao = 0;
    if (indices.nome_produto >= 0) pontuacao += 5;
    if (indices.enquadramento_produto >= 0) pontuacao += 2;
    if (indices.inflamavel >= 0 || indices.toxico >= 0) pontuacao += 2;
    if (indices.validade_produto >= 0) pontuacao += 1;

    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhorIndice = i;
    }
    if (pontuacao >= 8) break;
  }
  return melhorIndice;
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
  if (!valor) return null;

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

function normalizarEnquadramento(valor) {
  const norm = normalizar(valor);
  if (!norm) return 'PERIGOSO';
  if (norm.includes('NAO') || norm.includes('NÃO') || norm.includes('ISENTO') || norm.includes('NORMAL')) {
    return 'NÃO PERIGOSO';
  }
  return 'PERIGOSO';
}

// ============================================================================
// 2. ENDPOINT DE IMPORTAÇÃO (POST /api/ecogestao/produtos-quimicos/importar)
// ============================================================================
export const importarProdutosQuimicos = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({
      error: 'Arquivo nao enviado',
      message: 'Envie um arquivo .xlsx, .xls ou .csv no campo `arquivo`.',
    });
  }

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, {
      type: 'buffer',
      cellDates: false,
      raw: true,
    });
  } catch (erro) {
    return res.status(400).json({
      error: 'Falha ao processar arquivo',
      message: `Nao foi possivel ler a planilha: ${erro.message}`,
    });
  }

  const primeiroNomeAba = workbook.SheetNames[0];
  if (!primeiroNomeAba) {
    return res.status(400).json({
      error: 'Planilha vazia',
      message: 'O arquivo enviado nao contem abas validas.',
    });
  }

  const worksheet = workbook.Sheets[primeiroNomeAba];
  const linhas = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (!linhas.length) {
    return res.status(400).json({
      error: 'Planilha sem dados',
      message: 'Nenhuma linha encontrada na primeira aba.',
    });
  }

  const indiceCabecalho = localizarCabecalho(linhas);
  const cabecalho = linhas[indiceCabecalho] || [];
  const indices = mapearColunas(cabecalho);

  if (indices.nome_produto < 0) {
    return res.status(400).json({
      error: 'Cabecalho invalido',
      message: 'Coluna obrigatoria nao encontrada: Nome do Produto Quimico.',
      colunas_detectadas: cabecalho.map(texto).filter(Boolean),
    });
  }

  const avisos = [];
  const mapaDeduplicacao = new Map(); // chave: NOME_PRODUTO | MARCA

  for (let i = indiceCabecalho + 1; i < linhas.length; i += 1) {
    const linha = linhas[i];
    if (!linha || !linha.some((celula) => texto(celula) !== '')) {
      continue;
    }

    const numeroLinha = i + 1;
    const nomeBruto = texto(linha[indices.nome_produto]);
    if (!nomeBruto) {
      if (avisos.length < LIMITE_AVISOS) {
        avisos.push({
          linha: numeroLinha,
          motivo: 'Linha ignorada: nome do produto quimico em branco.',
        });
      }
      continue;
    }

    const marcaBruta = indices.marca_produto >= 0 ? texto(linha[indices.marca_produto]) : '';
    const chaveUnica = `${normalizar(nomeBruto)}|${normalizar(marcaBruta)}`;

    const fdsFispq = indices.fds_fispq >= 0 ? texto(linha[indices.fds_fispq]) : null;
    const substancias = indices.substancias_composicao >= 0 ? texto(linha[indices.substancias_composicao]) : null;
    const enquadramentoBruto = indices.enquadramento_produto >= 0 ? texto(linha[indices.enquadramento_produto]) : '';
    const enquadramento = normalizarEnquadramento(enquadramentoBruto);

    const validadeBruta = indices.validade_produto >= 0 ? linha[indices.validade_produto] : null;
    const validade = parseData(validadeBruta);

    const local = indices.local_armazenamento >= 0 ? texto(linha[indices.local_armazenamento]) : null;

    // Matriz de perigos
    const inflamavel = indices.inflamavel >= 0 ? parseBooleano(linha[indices.inflamavel]) : false;
    const piroforico = indices.piroforico >= 0 ? parseBooleano(linha[indices.piroforico]) : false;
    const explosivo = indices.explosivo >= 0 ? parseBooleano(linha[indices.explosivo]) : false;
    const oxidante = indices.oxidante >= 0 ? parseBooleano(linha[indices.oxidante]) : false;
    const corrosivo = indices.corrosivo >= 0 ? parseBooleano(linha[indices.corrosivo]) : false;
    const toxico = indices.toxico >= 0 ? parseBooleano(linha[indices.toxico]) : false;
    const radioativo = indices.radioativo >= 0 ? parseBooleano(linha[indices.radioativo]) : false;

    mapaDeduplicacao.set(chaveUnica, {
      nome_produto: nomeBruto.toUpperCase(),
      fds_fispq: fdsFispq ? fdsFispq.toUpperCase() : null,
      marca_produto: marcaBruta ? marcaBruta.toUpperCase() : null,
      substancias_composicao: substancias ? substancias.toUpperCase() : null,
      enquadramento_produto: enquadramento,
      validade_produto: validade,
      local_armazenamento: local ? local.toUpperCase() : null,
      inflamavel,
      piroforico,
      explosivo,
      oxidante,
      corrosivo,
      toxico,
      radioativo,
    });
  }

  const produtosParaProcessar = Array.from(mapaDeduplicacao.values());

  if (!produtosParaProcessar.length) {
    return res.status(400).json({
      error: 'Nenhum registro valido',
      message: 'Nenhum produto quimico valido foi encontrado na planilha.',
      avisos,
    });
  }

  // Buscar produtos já cadastrados no banco para evitar duplicatas por (nome + marca)
  const produtosExistentes = await prisma.produtoQuimico.findMany({
    select: { id: true, nome_produto: true, marca_produto: true },
  });

  const chavesExistentes = new Set(
    produtosExistentes.map((p) => `${normalizar(p.nome_produto)}|${normalizar(p.marca_produto || '')}`)
  );

  const novosParaInserir = produtosParaProcessar.filter((p) => {
    const chave = `${normalizar(p.nome_produto)}|${normalizar(p.marca_produto || '')}`;
    return !chavesExistentes.has(chave);
  });

  const duplicadosIgnorados = produtosParaProcessar.length - novosParaInserir.length;

  let totalInseridos = 0;
  if (novosParaInserir.length > 0) {
    for (let i = 0; i < novosParaInserir.length; i += TAMANHO_LOTE_INSERT) {
      const lote = novosParaInserir.slice(i, i + TAMANHO_LOTE_INSERT);
      const resultado = await comRetryConexao(() =>
        prisma.produtoQuimico.createMany({
          data: lote,
        })
      );
      totalInseridos += resultado.count;
    }
  }

  // Resumo da matriz de perigos dos produtos importados
  const matrizPerigos = {
    inflamavel: produtosParaProcessar.filter((p) => p.inflamavel).length,
    piroforico: produtosParaProcessar.filter((p) => p.piroforico).length,
    explosivo: produtosParaProcessar.filter((p) => p.explosivo).length,
    oxidante: produtosParaProcessar.filter((p) => p.oxidante).length,
    corrosivo: produtosParaProcessar.filter((p) => p.corrosivo).length,
    toxico: produtosParaProcessar.filter((p) => p.toxico).length,
    radioativo: produtosParaProcessar.filter((p) => p.radioativo).length,
  };

  const enquadramentos = {
    perigosos: produtosParaProcessar.filter((p) => p.enquadramento_produto === 'PERIGOSO').length,
    nao_perigosos: produtosParaProcessar.filter((p) => p.enquadramento_produto !== 'PERIGOSO').length,
  };

  await registrarLogAtividade(req, {
    acao: 'IMPORTAR_PRODUTOS_QUIMICOS',
    modulo: 'ECOGESTAO',
    detalhes: {
      arquivo: req.file.originalname,
      total_processados: produtosParaProcessar.length,
      inseridos: totalInseridos,
      duplicados_ignorados: duplicadosIgnorados,
    },
  }).catch(() => {});

  return res.status(200).json({
    sucesso: true,
    total_linhas: linhas.length - indiceCabecalho - 1,
    total_lidos: produtosParaProcessar.length,
    importados: totalInseridos,
    duplicados_ignorados: duplicadosIgnorados,
    matriz_perigos: matrizPerigos,
    enquadramentos,
    avisos: avisos.slice(0, LIMITE_AVISOS),
  });
});

// ============================================================================
// 3. ENDPOINTS DE CRUD E CONSULTAS AGREGADAS
// ============================================================================

/**
 * GET /api/ecogestao/produtos-quimicos
 * Lista produtos químicos com paginação, busca e filtros + Resumo Estatístico para KPIs
 */
export const listarProdutosQuimicos = asyncHandler(async (req, res) => {
  const {
    enquadramento,
    local,
    busca,
    perigo,
    status_validade,
    pagina = 1,
    limite = 50,
  } = req.query;

  const paginaNum = Math.max(1, parseInt(pagina, 10) || 1);
  const limiteNum = Math.min(1000, Math.max(1, parseInt(limite, 10) || 50));
  const skip = (paginaNum - 1) * limiteNum;

  const agora = new Date();
  const em30Dias = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Cláusula de filtro da listagem
  const where = {};

  if (enquadramento && enquadramento !== 'TODOS') {
    where.enquadramento_produto = enquadramento;
  }

  if (local && local !== 'TODOS') {
    where.local_armazenamento = {
      contains: String(local).trim(),
      mode: 'insensitive',
    };
  }

  if (perigo && perigo !== 'TODOS') {
    const flag = String(perigo).toLowerCase();
    if (['inflamavel', 'piroforico', 'explosivo', 'oxidante', 'corrosivo', 'toxico', 'radioativo'].includes(flag)) {
      where[flag] = true;
    }
  }

  if (status_validade) {
    if (status_validade === 'VENCIDO') {
      where.validade_produto = { lt: agora };
    } else if (status_validade === 'A_VENCER') {
      where.validade_produto = { gte: agora, lte: em30Dias };
    } else if (status_validade === 'NORMAL') {
      where.validade_produto = { gt: em30Dias };
    }
  }

  if (busca && String(busca).trim()) {
    const termo = String(busca).trim();
    where.OR = [
      { nome_produto: { contains: termo, mode: 'insensitive' } },
      { marca_produto: { contains: termo, mode: 'insensitive' } },
      { substancias_composicao: { contains: termo, mode: 'insensitive' } },
      { fds_fispq: { contains: termo, mode: 'insensitive' } },
      { local_armazenamento: { contains: termo, mode: 'insensitive' } },
    ];
  }

  // Consulta paginada e total filtrado
  const [produtos, totalFiltrado, todosProdutosResumo] = await Promise.all([
    prisma.produtoQuimico.findMany({
      where,
      skip,
      take: limiteNum,
      orderBy: [
        { enquadramento_produto: 'asc' },
        { nome_produto: 'asc' },
      ],
    }),
    prisma.produtoQuimico.count({ where }),
    // Consulta leve de todos os registros para calcular estatísticas globais
    prisma.produtoQuimico.findMany({
      select: {
        id: true,
        enquadramento_produto: true,
        validade_produto: true,
        local_armazenamento: true,
        substancias_composicao: true,
        inflamavel: true,
        piroforico: true,
        explosivo: true,
        oxidante: true,
        corrosivo: true,
        toxico: true,
        radioativo: true,
      },
    }),
  ]);

  // Cálculo das estatísticas globais (KPIs e Gráficos)
  let totalPerigosos = 0;
  let totalNaoPerigosos = 0;
  let totalVencidos = 0;
  let totalAVencer = 0;

  const matrizPerigos = {
    inflamavel: 0,
    piroforico: 0,
    explosivo: 0,
    oxidante: 0,
    corrosivo: 0,
    toxico: 0,
    radioativo: 0,
  };

  const contagemLocais = {};
  const contagemComposicoes = {};

  todosProdutosResumo.forEach((p) => {
    if (p.enquadramento_produto === 'PERIGOSO') {
      totalPerigosos += 1;
    } else {
      totalNaoPerigosos += 1;
    }

    if (p.validade_produto) {
      const dt = new Date(p.validade_produto);
      if (dt < agora) {
        totalVencidos += 1;
      } else if (dt <= em30Dias) {
        totalAVencer += 1;
      }
    }

    if (p.inflamavel) matrizPerigos.inflamavel += 1;
    if (p.piroforico) matrizPerigos.piroforico += 1;
    if (p.explosivo) matrizPerigos.explosivo += 1;
    if (p.oxidante) matrizPerigos.oxidante += 1;
    if (p.corrosivo) matrizPerigos.corrosivo += 1;
    if (p.toxico) matrizPerigos.toxico += 1;
    if (p.radioativo) matrizPerigos.radioativo += 1;

    const loc = p.local_armazenamento || 'NÃO INFORMADO';
    contagemLocais[loc] = (contagemLocais[loc] || 0) + 1;

    const comp = p.substancias_composicao || 'NÃO INFORMADA';
    contagemComposicoes[comp] = (contagemComposicoes[comp] || 0) + 1;
  });

  const porLocal = Object.entries(contagemLocais)
    .map(([localArmazenamento, total]) => ({ local: localArmazenamento, total }))
    .sort((a, b) => b.total - a.total);

  const porComposicao = Object.entries(contagemComposicoes)
    .map(([composicao, total]) => ({ composicao, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return res.status(200).json({
    produtos,
    paginacao: {
      total: totalFiltrado,
      pagina: paginaNum,
      limite: limiteNum,
      total_paginas: Math.ceil(totalFiltrado / limiteNum) || 1,
    },
    resumo: {
      total_produtos: todosProdutosResumo.length,
      total_perigosos: totalPerigosos,
      total_nao_perigosos: totalNaoPerigosos,
      total_vencidos: totalVencidos,
      total_a_vencer: totalAVencer,
      matriz_perigos: matrizPerigos,
      por_local: porLocal,
      por_composicao: porComposicao,
    },
  });
});

/**
 * POST /api/ecogestao/produtos-quimicos
 * Cadastro manual de produto químico
 */
export const criarProdutoQuimico = asyncHandler(async (req, res) => {
  const {
    nome_produto,
    fds_fispq,
    marca_produto,
    substancias_composicao,
    enquadramento_produto = 'PERIGOSO',
    validade_produto,
    local_armazenamento,
    inflamavel = false,
    piroforico = false,
    explosivo = false,
    oxidante = false,
    corrosivo = false,
    toxico = false,
    radioativo = false,
  } = req.body;

  if (!nome_produto || !String(nome_produto).trim()) {
    return res.status(400).json({
      error: 'Dados invalidos',
      message: 'O campo Nome do Produto Quimico e obrigatorio.',
    });
  }

  const validade = validade_produto ? parseData(validade_produto) : null;
  const enquadramento = normalizarEnquadramento(enquadramento_produto);

  const novoProduto = await prisma.produtoQuimico.create({
    data: {
      nome_produto: String(nome_produto).trim().toUpperCase(),
      fds_fispq: fds_fispq ? String(fds_fispq).trim().toUpperCase() : null,
      marca_produto: marca_produto ? String(marca_produto).trim().toUpperCase() : null,
      substancias_composicao: substancias_composicao ? String(substancias_composicao).trim().toUpperCase() : null,
      enquadramento_produto: enquadramento,
      validade_produto: validade,
      local_armazenamento: local_armazenamento ? String(local_armazenamento).trim().toUpperCase() : null,
      inflamavel: Boolean(inflamavel),
      piroforico: Boolean(piroforico),
      explosivo: Boolean(explosivo),
      oxidante: Boolean(oxidante),
      corrosivo: Boolean(corrosivo),
      toxico: Boolean(toxico),
      radioativo: Boolean(radioativo),
    },
  });

  await registrarLogAtividade(req, {
    acao: 'CRIAR_PRODUTO_QUIMICO',
    modulo: 'ECOGESTAO',
    detalhes: {
      id: novoProduto.id,
      nome_produto: novoProduto.nome_produto,
      enquadramento: novoProduto.enquadramento_produto,
    },
  }).catch(() => {});

  return res.status(201).json(novoProduto);
});

/**
 * PUT /api/ecogestao/produtos-quimicos/:id
 * Atualização de produto químico
 */
export const atualizarProdutoQuimico = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    nome_produto,
    fds_fispq,
    marca_produto,
    substancias_composicao,
    enquadramento_produto,
    validade_produto,
    local_armazenamento,
    inflamavel,
    piroforico,
    explosivo,
    oxidante,
    corrosivo,
    toxico,
    radioativo,
  } = req.body;

  const existente = await prisma.produtoQuimico.findUnique({
    where: { id },
  });

  if (!existente) {
    return res.status(404).json({
      error: 'Nao encontrado',
      message: 'Produto quimico nao localizado.',
    });
  }

  const dadosAtualizados = {};

  if (nome_produto !== undefined) {
    if (!String(nome_produto).trim()) {
      return res.status(400).json({
        error: 'Dados invalidos',
        message: 'O campo Nome do Produto Quimico nao pode ficar em branco.',
      });
    }
    dadosAtualizados.nome_produto = String(nome_produto).trim().toUpperCase();
  }

  if (fds_fispq !== undefined) {
    dadosAtualizados.fds_fispq = fds_fispq ? String(fds_fispq).trim().toUpperCase() : null;
  }

  if (marca_produto !== undefined) {
    dadosAtualizados.marca_produto = marca_produto ? String(marca_produto).trim().toUpperCase() : null;
  }

  if (substancias_composicao !== undefined) {
    dadosAtualizados.substancias_composicao = substancias_composicao ? String(substancias_composicao).trim().toUpperCase() : null;
  }

  if (enquadramento_produto !== undefined) {
    dadosAtualizados.enquadramento_produto = normalizarEnquadramento(enquadramento_produto);
  }

  if (validade_produto !== undefined) {
    dadosAtualizados.validade_produto = validade_produto ? parseData(validade_produto) : null;
  }

  if (local_armazenamento !== undefined) {
    dadosAtualizados.local_armazenamento = local_armazenamento ? String(local_armazenamento).trim().toUpperCase() : null;
  }

  if (inflamavel !== undefined) dadosAtualizados.inflamavel = Boolean(inflamavel);
  if (piroforico !== undefined) dadosAtualizados.piroforico = Boolean(piroforico);
  if (explosivo !== undefined) dadosAtualizados.explosivo = Boolean(explosivo);
  if (oxidante !== undefined) dadosAtualizados.oxidante = Boolean(oxidante);
  if (corrosivo !== undefined) dadosAtualizados.corrosivo = Boolean(corrosivo);
  if (toxico !== undefined) dadosAtualizados.toxico = Boolean(toxico);
  if (radioativo !== undefined) dadosAtualizados.radioativo = Boolean(radioativo);

  const produtoAtualizado = await prisma.produtoQuimico.update({
    where: { id },
    data: dadosAtualizados,
  });

  await registrarLogAtividade(req, {
    acao: 'ATUALIZAR_PRODUTO_QUIMICO',
    modulo: 'ECOGESTAO',
    detalhes: {
      id,
      alteracoes: dadosAtualizados,
    },
  }).catch(() => {});

  return res.status(200).json(produtoAtualizado);
});

/**
 * DELETE /api/ecogestao/produtos-quimicos/:id
 * Exclusão de produto químico
 */
export const excluirProdutoQuimico = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existente = await prisma.produtoQuimico.findUnique({
    where: { id },
  });

  if (!existente) {
    return res.status(404).json({
      error: 'Nao encontrado',
      message: 'Produto quimico nao localizado.',
    });
  }

  await prisma.produtoQuimico.delete({
    where: { id },
  });

  await registrarLogAtividade(req, {
    acao: 'EXCLUIR_PRODUTO_QUIMICO',
    modulo: 'ECOGESTAO',
    detalhes: {
      id,
      nome_produto: existente.nome_produto,
      marca_produto: existente.marca_produto,
    },
  }).catch(() => {});

  return res.status(200).json({
    sucesso: true,
    message: 'Produto quimico excluido com sucesso.',
  });
});
