// ============================================================================
// src/controllers/atosController.js — Atos Autorizativos / Licenças (EcoGestão).
//
// Sub-módulo para controle de licenças, alvarás, certificados e conformidade:
//   POST /api/ecogestao/atos/importar  (multipart, campo `arquivo`)
//     Aceita .xlsx, .xls e .csv. Lê a planilha, mapeia colunas flexíveis,
//     calcula automaticamente o farol de vencimentos (Vencido, A Vencer, Normal),
//     deduplica e insere em lote.
//   GET  /api/ecogestao/atos
//     Lista as licenças com filtros (status, farol, busca) e resumo estatístico
//     para o Dashboard (total, vencidas, a vencer, normais).
//   POST /api/ecogestao/atos
//     Cadastro manual individual de ato autorizativo.
//   PUT  /api/ecogestao/atos/:id
//     Atualização manual de ato autorizativo (com recálculo do farol).
//   DELETE /api/ecogestao/atos/:id
//     Exclusão de ato autorizativo.
// ============================================================================
import XLSX from 'xlsx';
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { registrarLogAtividade } from '../services/auditService.js';
import { comRetryConexao } from '../utils/retryBanco.js';

const LIMITE_AVISOS = 50;
const TAMANHO_LOTE_INSERT = 1000;

// Campos obrigatórios mínimos
const CAMPOS_OBRIGATORIOS = ['descricao_do_tipo_de_servico', 'licenca', 'validade'];

// Cabeçalhos aceitos
const COLUNAS = {
  descricao_do_tipo_de_servico: [
    'DESCRICAO DO TIPO DE SERVICO',
    'DESCRICAO DO TIPO DE SERVIÇO',
    'DESCRICAO TIPO SERVICO',
    'TIPO DE SERVICO',
    'TIPO DE SERVIÇO',
    'TIPO SERVICO',
    'DESCRICAO',
    'DESCRIÇÃO',
    'EMPRESA',
    'PRESTADOR',
    'FORNECEDOR',
    'SERVICO',
    'SERVIÇO',
    'ESTABELECIMENTO',
  ],
  status: [
    'STATUS',
    'SITUACAO',
    'SITUAÇÃO',
    'ESTADO',
  ],
  licenca: [
    'LICENCA',
    'LICENÇA',
    'DOCUMENTO',
    'TIPO LICENCA',
    'TIPO DE LICENCA',
    'CERTIFICADO',
    'ALVARA',
    'ALVARÁ',
    'AUTORIZACAO',
    'AUTORIZAÇÃO',
    'ATO AUTORIZATIVO',
  ],
  validade: [
    'VALIDADE',
    'VENCIMENTO',
    'DATA DE VALIDADE',
    'DATA DE VENCIMENTO',
    'DT VALIDADE',
    'DT VENCIMENTO',
    'DATA VALIDADE',
    'DATA VENCIMENTO',
    'PRAZO',
  ],
  farol_de_vencimentos: [
    'FAROL DE VENCIMENTOS',
    'FAROL DE VENCIMENTO',
    'FAROL',
    'STATUS FAROL',
    'ALERTA',
    'FAROL VENCIMENTO',
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

// ============================================================================
// LÓGICA DO FAROL DE VENCIMENTOS (AUTOMÁTICA)
// ============================================================================
export function calcularFarol(validade, dataReferencia = new Date()) {
  if (!validade) return 'Normal';
  const val = new Date(validade);
  if (Number.isNaN(val.getTime())) return 'Normal';

  // Normalização para início do dia em UTC
  const anoV = val.getUTCFullYear();
  const mesV = val.getUTCMonth();
  const diaV = val.getUTCDate();
  const dataValidade = new Date(Date.UTC(anoV, mesV, diaV));

  const anoH = dataReferencia.getUTCFullYear();
  const mesH = dataReferencia.getUTCMonth();
  const diaH = dataReferencia.getUTCDate();
  const dataHoje = new Date(Date.UTC(anoH, mesH, diaH));

  const diferencaMs = dataValidade.getTime() - dataHoje.getTime();
  const diasRestantes = Math.ceil(diferencaMs / (1000 * 60 * 60 * 24));

  if (diasRestantes < 0) {
    return 'Vencido';
  }
  if (diasRestantes <= 30) {
    return 'A Vencer';
  }
  return 'Normal';
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

function gerarHashAto(item) {
  const servico = String(item.descricao_do_tipo_de_servico || '').trim().toUpperCase();
  const licenca = String(item.licenca || '').trim().toUpperCase();
  const dtStr = item.validade instanceof Date
    ? item.validade.toISOString().slice(0, 10)
    : String(item.validade).slice(0, 10);
  return `${servico}|${licenca}|${dtStr}`;
}

// ============================================================================
// 1. IMPORTAÇÃO DE PLANILHA (POST /api/ecogestao/atos/importar)
// ============================================================================
export const importarAtos = asyncHandler(async (req, res) => {
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
      message: 'Não foi possível interpretar a planilha. Verifique a extensão e codificação.',
      detalhes: erro.message,
    });
  }

  if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
    return res.status(400).json({
      error: 'Planilha vazia',
      message: 'O arquivo enviado não possui planilhas válidas.',
    });
  }

  const nomeAba = escolherAba(workbook);
  const sheet = workbook.Sheets[nomeAba];
  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  if (!matriz || matriz.length < 2) {
    return res.status(400).json({
      error: 'Dados insuficientes',
      message: 'A planilha selecionada está vazia ou não contém dados além do cabeçalho.',
    });
  }

  const indiceCabecalho = localizarCabecalho(matriz);
  const cabecalhoLinha = matriz[indiceCabecalho] || [];
  const indices = mapearColunas(cabecalhoLinha);

  const colunasFaltantes = CAMPOS_OBRIGATORIOS.filter((campo) => indices[campo] < 0);
  if (colunasFaltantes.length > 0) {
    return res.status(400).json({
      error: 'Cabeçalho inválido',
      message: `As seguintes colunas obrigatórias não foram encontradas: ${colunasFaltantes.join(', ')}.`,
      cabecalho_encontrado: cabecalhoLinha.filter(Boolean),
    });
  }

  const linhasValidas = [];
  const avisos = [];
  const hoje = new Date();

  for (let i = indiceCabecalho + 1; i < matriz.length; i += 1) {
    const linha = matriz[i];
    if (!Array.isArray(linha) || linha.every((c) => texto(c) === '')) continue;

    const numeroLinha = i + 1;

    const servicoBruto = texto(linha[indices.descricao_do_tipo_de_servico]);
    if (!servicoBruto) {
      if (avisos.length < LIMITE_AVISOS) {
        avisos.push({ linha: numeroLinha, motivo: 'Descrição do tipo de serviço ausente' });
      }
      continue;
    }

    const licencaBruto = texto(linha[indices.licenca]);
    if (!licencaBruto) {
      if (avisos.length < LIMITE_AVISOS) {
        avisos.push({ linha: numeroLinha, motivo: 'Descrição da licença/alvará ausente' });
      }
      continue;
    }

    const valorValidade = linha[indices.validade];
    const dataValidade = parseData(valorValidade);
    if (!dataValidade) {
      if (avisos.length < LIMITE_AVISOS) {
        avisos.push({ linha: numeroLinha, motivo: `Data de validade inválida: "${texto(valorValidade)}"` });
      }
      continue;
    }

    let statusBruto = indices.status >= 0 ? texto(linha[indices.status]).toUpperCase() : 'ATIVO';
    if (!statusBruto || statusBruto === '') statusBruto = 'ATIVO';

    // Cálculo automático do farol de vencimentos com base na validade
    const farolCalculado = calcularFarol(dataValidade, hoje);

    linhasValidas.push({
      descricao_do_tipo_de_servico: servicoBruto.toUpperCase(),
      status: statusBruto,
      licenca: licencaBruto.toUpperCase(),
      validade: dataValidade,
      farol_de_vencimentos: farolCalculado,
    });
  }

  if (linhasValidas.length === 0) {
    return res.status(400).json({
      error: 'Nenhum registro válido',
      message: 'Nenhuma linha válida foi encontrada para importação.',
      avisos,
    });
  }

  // Deduplicação: busca existentes no banco
  const existentes = await comRetryConexao(
    () => prisma.atoAutorizativo.findMany({
      select: {
        descricao_do_tipo_de_servico: true,
        licenca: true,
        validade: true,
      },
    }),
    3,
    500,
    'atos:existentes',
  );

  const hashSet = new Set();
  existentes.forEach((item) => hashSet.add(gerarHashAto(item)));

  const registrosParaInserir = [];
  let duplicadosIgnorados = 0;
  let totalVencidos = 0;
  let totalAVencer = 0;
  let totalNormais = 0;

  for (const item of linhasValidas) {
    const hash = gerarHashAto(item);
    if (hashSet.has(hash)) {
      duplicadosIgnorados += 1;
      continue;
    }
    hashSet.add(hash);
    registrosParaInserir.push(item);

    if (item.farol_de_vencimentos === 'Vencido') totalVencidos += 1;
    else if (item.farol_de_vencimentos === 'A Vencer') totalAVencer += 1;
    else totalNormais += 1;
  }

  let totalInseridos = 0;
  if (registrosParaInserir.length > 0) {
    for (let pos = 0; pos < registrosParaInserir.length; pos += TAMANHO_LOTE_INSERT) {
      const lote = registrosParaInserir.slice(pos, pos + TAMANHO_LOTE_INSERT);
      const resultado = await comRetryConexao(
        () => prisma.atoAutorizativo.createMany({ data: lote }),
        3,
        700,
        'atos:createMany',
      );
      totalInseridos += resultado.count;
    }
  }

  await registrarLogAtividade(req, {
    acao: 'IMPORTAR_ATOS_AUTORIZATIVOS',
    modulo: 'EcoGestao',
    detalhes: {
      arquivo: req.file.originalname,
      total_lido: matriz.length - indiceCabecalho - 1,
      validos: linhasValidas.length,
      inseridos: totalInseridos,
      duplicados_ignorados: duplicadosIgnorados,
      linhas_invalidas: avisos.length,
      vencidos: totalVencidos,
      a_vencer: totalAVencer,
      normais: totalNormais,
    },
  });

  return res.status(200).json({
    sucesso: true,
    mensagem: `Importação concluída: ${totalInseridos} ato(s) autorizativo(s) inserido(s) com sucesso.`,
    resumo: {
      total_linhas_planilha: matriz.length - indiceCabecalho - 1,
      importados: totalInseridos,
      duplicados_ignorados: duplicadosIgnorados,
      linhas_invalidas: avisos.length,
      total_vencidos: totalVencidos,
      total_a_vencer: totalAVencer,
      total_normais: totalNormais,
    },
    avisos: avisos.slice(0, LIMITE_AVISOS),
  });
});

// ============================================================================
// 2. LISTAGEM COM RESUMO ESTATÍSTICO (GET /api/ecogestao/atos)
// ============================================================================
export const listarAtos = asyncHandler(async (req, res) => {
  const {
    status,
    farol,
    busca,
    pagina = 1,
    limite = 100,
  } = req.query;

  const where = {};
  if (status && status !== 'TODOS') {
    where.status = { equals: String(status).trim().toUpperCase() };
  }
  if (farol && farol !== 'TODOS') {
    where.farol_de_vencimentos = { equals: String(farol).trim() };
  }
  if (busca) {
    const termo = String(busca).trim();
    where.OR = [
      { descricao_do_tipo_de_servico: { contains: termo, mode: 'insensitive' } },
      { licenca: { contains: termo, mode: 'insensitive' } },
    ];
  }

  const pag = Math.max(1, parseInt(pagina, 10) || 1);
  const lim = Math.max(1, Math.min(1000, parseInt(limite, 10) || 100));
  const skip = (pag - 1) * lim;

  // Busca lista e todos os dados para o resumo dos KPIs
  const [totalGeral, itens, todosAtos] = await comRetryConexao(
    () => Promise.all([
      prisma.atoAutorizativo.count({ where }),
      prisma.atoAutorizativo.findMany({
        where,
        orderBy: [{ validade: 'asc' }, { created_at: 'desc' }],
        skip,
        take: lim,
      }),
      prisma.atoAutorizativo.findMany({
        select: {
          id: true,
          status: true,
          validade: true,
          descricao_do_tipo_de_servico: true,
          farol_de_vencimentos: true,
        },
      }),
    ]),
    3,
    500,
    'atos:listar',
  );

  const hoje = new Date();

  // Recalcula farol dinamicamente para os KPIs em tempo real
  let totalAtivas = 0;
  let totalInativas = 0;
  let totalVencidas = 0;
  let totalAVencer = 0;
  let totalNormais = 0;
  const mapaServicos = {};

  for (const ato of todosAtos) {
    const statusAtivo = String(ato.status || '').toUpperCase() === 'ATIVO';
    if (statusAtivo) totalAtivas += 1;
    else totalInativas += 1;

    // Farol dinâmico baseado no dia de hoje
    const farolDinamico = calcularFarol(ato.validade, hoje);
    if (farolDinamico === 'Vencido') totalVencidas += 1;
    else if (farolDinamico === 'A Vencer') totalAVencer += 1;
    else totalNormais += 1;

    const serv = ato.descricao_do_tipo_de_servico ? ato.descricao_do_tipo_de_servico.toUpperCase() : 'OUTROS';
    if (!mapaServicos[serv]) {
      mapaServicos[serv] = { servico: serv, total: 0, vencidos: 0, a_vencer: 0, normais: 0 };
    }
    mapaServicos[serv].total += 1;
    if (farolDinamico === 'Vencido') mapaServicos[serv].vencidos += 1;
    else if (farolDinamico === 'A Vencer') mapaServicos[serv].a_vencer += 1;
    else mapaServicos[serv].normais += 1;
  }

  const totalGeralTodos = todosAtos.length;
  const porServico = Object.values(mapaServicos).sort((a, b) => b.total - a.total);

  // Enriquece a lista com o farol atualizado dinamicamente
  const itensComFarolAtualizado = itens.map((ato) => ({
    ...ato,
    farol_de_vencimentos: calcularFarol(ato.validade, hoje),
  }));

  return res.status(200).json({
    dados: itensComFarolAtualizado,
    resumo: {
      total_licencas: totalGeralTodos,
      total_ativas: totalAtivas,
      total_inativas: totalInativas,
      total_vencidas: totalVencidas,
      total_a_vencer: totalAVencer,
      total_normais: totalNormais,
      por_servico: porServico,
      taxa_conformidade: totalGeralTodos > 0
        ? Number(((totalNormais / totalGeralTodos) * 100).toFixed(1))
        : 100,
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
// 3. CRUD MANUAL INDIVIDUAL (POST, PUT, DELETE)
// ============================================================================
export const criarAto = asyncHandler(async (req, res) => {
  const { descricao_do_tipo_de_servico, licenca, validade, status = 'ATIVO' } = req.body;

  if (!descricao_do_tipo_de_servico || !texto(descricao_do_tipo_de_servico)) {
    return res.status(400).json({
      error: 'Descrição do tipo de serviço obrigatória',
      message: 'Informe a descrição do tipo de serviço / fornecedor.',
    });
  }

  if (!licenca || !texto(licenca)) {
    return res.status(400).json({
      error: 'Licença obrigatória',
      message: 'Informe o tipo ou número da licença / alvará.',
    });
  }

  const dataValidade = parseData(validade);
  if (!dataValidade) {
    return res.status(400).json({
      error: 'Data de validade inválida',
      message: 'Informe uma data de validade válida (formato YYYY-MM-DD ou DD/MM/YYYY).',
    });
  }

  const farol = calcularFarol(dataValidade, new Date());

  const novo = await comRetryConexao(
    () => prisma.atoAutorizativo.create({
      data: {
        descricao_do_tipo_de_servico: String(descricao_do_tipo_de_servico).trim().toUpperCase(),
        licenca: String(licenca).trim().toUpperCase(),
        validade: dataValidade,
        status: String(status || 'ATIVO').trim().toUpperCase(),
        farol_de_vencimentos: farol,
      },
    }),
    3,
    500,
    'atos:criar',
  );

  await registrarLogAtividade(req, {
    acao: 'CRIAR_ATO_AUTORIZATIVO',
    modulo: 'EcoGestao',
    detalhes: { id: novo.id, licenca: novo.licenca, servico: novo.descricao_do_tipo_de_servico },
  });

  return res.status(201).json({
    sucesso: true,
    mensagem: 'Ato autorizativo cadastrado com sucesso.',
    dado: novo,
  });
});

export const atualizarAto = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { descricao_do_tipo_de_servico, licenca, validade, status } = req.body;

  const existente = await prisma.atoAutorizativo.findUnique({ where: { id } });
  if (!existente) {
    return res.status(404).json({
      error: 'Registro não encontrado',
      message: 'Ato autorizativo não localizado.',
    });
  }

  const dadosAtualizacao = {};

  if (descricao_do_tipo_de_servico !== undefined) {
    dadosAtualizacao.descricao_do_tipo_de_servico = String(descricao_do_tipo_de_servico).trim().toUpperCase();
  }

  if (licenca !== undefined) {
    dadosAtualizacao.licenca = String(licenca).trim().toUpperCase();
  }

  if (status !== undefined) {
    dadosAtualizacao.status = String(status).trim().toUpperCase();
  }

  if (validade !== undefined) {
    const dataValidade = parseData(validade);
    if (!dataValidade) {
      return res.status(400).json({ error: 'Data de validade inválida' });
    }
    dadosAtualizacao.validade = dataValidade;
    dadosAtualizacao.farol_de_vencimentos = calcularFarol(dataValidade, new Date());
  }

  const atualizado = await comRetryConexao(
    () => prisma.atoAutorizativo.update({
      where: { id },
      data: dadosAtualizacao,
    }),
    3,
    500,
    'atos:atualizar',
  );

  await registrarLogAtividade(req, {
    acao: 'ATUALIZAR_ATO_AUTORIZATIVO',
    modulo: 'EcoGestao',
    detalhes: { id, alteracoes: dadosAtualizacao },
  });

  return res.status(200).json({
    sucesso: true,
    mensagem: 'Ato autorizativo atualizado com sucesso.',
    dado: atualizado,
  });
});

export const excluirAto = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existente = await prisma.atoAutorizativo.findUnique({ where: { id } });
  if (!existente) {
    return res.status(404).json({
      error: 'Registro não encontrado',
      message: 'Ato autorizativo não localizado.',
    });
  }

  await comRetryConexao(
    () => prisma.atoAutorizativo.delete({ where: { id } }),
    3,
    500,
    'atos:excluir',
  );

  await registrarLogAtividade(req, {
    acao: 'EXCLUIR_ATO_AUTORIZATIVO',
    modulo: 'EcoGestao',
    detalhes: { id, licenca: existente.licenca, servico: existente.descricao_do_tipo_de_servico },
  });

  return res.status(200).json({
    sucesso: true,
    mensagem: 'Ato autorizativo excluído com sucesso.',
  });
});

// ============================================================================
// 4. EXCLUSÃO EM LOTE (POST /api/ecogestao/atos/excluir-lote)
// ============================================================================
export const excluirAtosLote = asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({
      error: 'IDs inválidos',
      message: 'Envie um array "ids" com ao menos um ID para exclusão em lote.',
    });
  }

  const idsValidos = ids.map(String).filter(Boolean);
  const resultado = await comRetryConexao(
    () => prisma.atoAutorizativo.deleteMany({
      where: { id: { in: idsValidos } },
    }),
    3,
    500,
    'atos:excluirLote',
  );

  await registrarLogAtividade(req, {
    acao: 'EXCLUIR_ATOS_LOTE',
    modulo: 'EcoGestao',
    detalhes: { total_solicitado: idsValidos.length, total_excluido: resultado.count },
  }).catch(() => {});

  return res.status(200).json({
    sucesso: true,
    total_excluido: resultado.count,
    mensagem: `${resultado.count} ${resultado.count === 1 ? 'ato excluído' : 'atos excluídos'} com sucesso.`,
  });
});
