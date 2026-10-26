// ============================================================================
// src/controllers/abastecimentoController.js — Controle de Combustível.
//
// Módulo operacional/ambiental (sem custos financeiros):
//   POST /api/abastecimentos/importar  (multipart, campo `arquivo`)
//     Aceita .xlsx, .xls e .csv. O parser localiza o cabeçalho da matriz,
//     cruza a PLACA com MobDesmob (TAG/modelo), calcula a emissão de CO2 e
//     grava o mês de referência (YYYY-MM).
//   GET /api/abastecimentos?mes=YYYY-MM
//     Lista os lançamentos do mês + resumo de litros, CO2 e consumo médio.
//   GET /api/abastecimentos/meses
//     Meses disponíveis para o filtro do dashboard.
//
// Fatores de emissão (kg CO2 por litro):
//   Diesel / Diesel S10 .... 2,68
//   Gasolina ............... 2,26
//   Etanol ................. 0,45
//   Outros / Arla 32 ....... 0,00
// ============================================================================
import XLSX from 'xlsx';
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { registrarLogAtividade } from '../services/auditService.js';
import { comRetryConexao } from '../utils/retryBanco.js';

const LIMITE_ERROS_DETALHADOS = 50;
const TAMANHO_LOTE_INSERT = 1000;
const TAMANHO_MAXIMO_PLACA = 20;
const MES_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

const CAMPOS_OBRIGATORIOS = ['placa', 'data_transacao', 'tipo_combustivel', 'litros'];

// Cabeçalhos aceitos (normalizados: sem acentos, caixa alta e sem pontuação).
// Colunas financeiras como VALOR EMISSAO/VALOR TOTAL são deliberadamente
// ignoradas: o módulo acompanha litros, consumo e CO2, não custos.
const COLUNAS = {
  placa: ['PLACA', 'PLACA DO VEICULO', 'PLACA VEICULO'],
  data_transacao: [
    'DATA TRANSACAO',
    'DATA DA TRANSACAO',
    'DATA DO ABASTECIMENTO',
    'DATA',
    'DT TRANSACAO',
  ],
  tipo_combustivel: [
    'TIPO COMBUSTIVEL',
    'TIPO DE COMBUSTIVEL',
    'COMBUSTIVEL',
    'PRODUTO',
  ],
  litros: [
    'LITROS',
    'LITROS ABASTECIDOS',
    'QUANTIDADE',
    'QUANTIDADE LITROS',
    'QTD LITROS',
    'VOLUME',
  ],
  codigo_transacao: ['CODIGO TRANSACAO', 'CODIGO DA TRANSACAO', 'CODIGO', 'TRANSACAO'],
  forma_pagamento: ['FORMA PAGAMENTO', 'FORMA DE PAGAMENTO', 'PAGAMENTO'],
  tag: ['TAG', 'TAG VEICULO', 'TAG DO VEICULO'],
  modelo_veiculo: ['MODELO VEICULO', 'MODELO DO VEICULO', 'MODELO', 'CATEGORIA'],
  nome_motorista: ['NOME MOTORISTA', 'NOME DO MOTORISTA', 'MOTORISTA', 'CONDUTOR'],
  hodometro_horimetro: [
    'HODOMETRO OU HORIMETRO',
    'HODOMETRO HORIMETRO',
    'HODOMETRO',
    'HORIMETRO',
    'ODOMETRO',
  ],
  km_rodados_horas: [
    'KM RODADOS OU HORAS TRABALHADAS',
    'KM RODADOS HORAS TRABALHADAS',
    'KM RODADOS',
    'HORAS TRABALHADAS',
    'HORAS TRABALHADA',
  ],
  km_por_litro: ['KM POR LITRO', 'KM L', 'KM/L', 'MEDIA KM L'],
  estabelecimento: ['ESTABELECIMENTO', 'POSTO', 'FORNECEDOR', 'LOCAL'],
  contrato: ['CONTRATO', 'NUMERO CONTRATO', 'NUMERO DO CONTRATO'],
};

function texto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/\s+/g, ' ').trim();
}

// Normalização tolerante para cabeçalhos, placas e tipos de combustível.
function normalizar(valor) {
  return texto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function chaveCabecalho(valor) {
  return normalizar(valor).replace(/[^A-Z0-9]+/g, ' ').trim();
}

function chavePlaca(valor) {
  return normalizar(valor).replace(/[^A-Z0-9]/g, '');
}

function normalizarPlaca(valor) {
  return texto(valor).toUpperCase().slice(0, TAMANHO_MAXIMO_PLACA);
}

function textoLimitado(valor, limite) {
  const limpo = texto(valor);
  return limpo ? limpo.slice(0, limite) : null;
}

function arredondar(valor, casas = 3) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  const fator = 10 ** casas;
  return Math.round(numero * fator) / fator;
}

function valorDaLinha(linha, indice) {
  if (!Array.isArray(linha) || indice < 0) return null;
  return linha[indice] ?? null;
}

function linhaVazia(linha) {
  return !Array.isArray(linha) || linha.every((valor) => texto(valor) === '');
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

// A matriz pode ter linhas de título antes do cabeçalho. Procura, entre as
// primeiras linhas, a que contém mais colunas obrigatórias reconhecidas.
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
    // Formato pt-BR (1.234,56) ou en-US (1,234.56).
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
    || data.getUTCHours() !== hora
    || data.getUTCMinutes() !== minuto
    || data.getUTCSeconds() !== segundo
  ) {
    return null;
  }
  return data;
}

function parseDataTransacao(valor) {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    const ano = valor.getFullYear();
    const mes = valor.getMonth() + 1;
    const dia = valor.getDate();
    const hora = valor.getHours();
    const minuto = valor.getMinutes();
    const segundo = valor.getSeconds();

    // O SheetJS pode devolver 23:59:xx para uma célula de data sem hora.
    // Nesse caso, avança para a meia-noite do dia seguinte.
    if (hora === 23 && minuto === 59) {
      return new Date(Date.UTC(ano, mes - 1, dia + 1));
    }
    return dataUTC(ano, mes, dia, hora, minuto, segundo);
  }

  if (typeof valor === 'number' && Number.isFinite(valor)) {
    const partes = XLSX.SSF.parse_date_code(valor);
    if (!partes) return null;

    const hora = partes.H || 0;
    const minuto = partes.M || 0;
    const segundo = Math.floor(partes.S || 0);
    if (hora === 23 && minuto === 59) {
      return new Date(Date.UTC(partes.y, partes.m - 1, partes.d + 1));
    }
    return dataUTC(partes.y, partes.m, partes.d, hora, minuto, segundo);
  }

  const bruto = texto(valor);
  if (!bruto) return null;

  // AAAA-MM-DD (com hora opcional).
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(bruto);
  if (match) {
    return dataUTC(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
    );
  }

  // DD/MM/AAAA (com hora opcional).
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(bruto);
  if (match) {
    let ano = Number(match[3]);
    if (ano < 100) ano += ano >= 70 ? 1900 : 2000;
    return dataUTC(
      ano,
      Number(match[2]),
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
    );
  }

  const data = new Date(bruto);
  return Number.isNaN(data.getTime()) ? null : data;
}

function mesReferencia(data) {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

function fatorEmissaoCO2(tipoCombustivel) {
  const tipo = normalizar(tipoCombustivel);
  if (!tipo) return 0;
  if (tipo.includes('ARLA')) return 0;
  if (tipo.includes('DIESEL')) return 2.68;
  if (tipo.includes('GASOLINA')) return 2.26;
  if (tipo.includes('ETANOL') || tipo.includes('ALCOOL')) return 0.45;
  return 0;
}

function calcularEmissaoCO2(litros, tipoCombustivel) {
  return arredondar(litros * fatorEmissaoCO2(tipoCombustivel), 3);
}

function decodificarCsv(buffer) {
  const bytes = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF
    ? buffer.subarray(3)
    : buffer;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Planilhas exportadas pelo Excel em português podem vir em Windows-1252.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function lerPlanilha(arquivo) {
  const nome = String(arquivo.originalname || '').toLowerCase();
  // Sem `cellDates`: datas do Excel chegam como serial numérico, o que evita
  // deslocamentos de fuso e permite normalizar o arredondamento da meia-noite.
  const opcoes = { type: 'buffer', raw: true };

  // CSV brasileiro costuma usar ponto e vírgula como separador. A matriz pode
  // ter linhas de título antes do cabeçalho, então avaliamos as primeiras linhas.
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

function escolherAba(workbook, solicitada) {
  const nome = texto(solicitada);
  if (nome && workbook.SheetNames.includes(nome)) return nome;

  for (const nomeAba of workbook.SheetNames) {
    const sheet = workbook.Sheets[nomeAba];
    if (!sheet?.['!ref']) continue;
    const intervalo = XLSX.utils.decode_range(sheet['!ref']);
    if (intervalo.e.r > intervalo.s.r) return nomeAba;
  }
  return workbook.SheetNames[0] || null;
}

async function carregarVeiculosPorPlaca() {
  const veiculos = await comRetryConexao(
    () => prisma.mobDesmob.findMany({
      select: { tag: true, placa: true, modelo: true, contrato: true },
    }),
    3,
    700,
    'abastecimentos',
  );

  const mapa = new Map();
  for (const veiculo of veiculos) {
    const chave = chavePlaca(veiculo.placa);
    if (chave && !mapa.has(chave)) mapa.set(chave, veiculo);
  }
  return mapa;
}

function chaveRegistro(codigo, placa, dataTransacao, litros) {
  if (!codigo) return null;
  return [
    codigo,
    chavePlaca(placa),
    dataTransacao instanceof Date ? dataTransacao.toISOString() : new Date(dataTransacao).toISOString(),
    Number(litros),
  ].join('|');
}

async function buscarChavesExistentes(codigos) {
  const existentes = new Set();
  const lista = [...codigos];

  for (let i = 0; i < lista.length; i += TAMANHO_LOTE_INSERT) {
    const lote = lista.slice(i, i + TAMANHO_LOTE_INSERT);
    const encontrados = await comRetryConexao(
      () => prisma.abastecimento.findMany({
        where: { codigo_transacao: { in: lote } },
        select: {
          codigo_transacao: true,
          placa: true,
          data_transacao: true,
          litros: true,
        },
      }),
      3,
      700,
      'abastecimentos',
    );
    for (const item of encontrados) {
      const chave = chaveRegistro(
        item.codigo_transacao,
        item.placa,
        item.data_transacao,
        item.litros,
      );
      if (chave) existentes.add(chave);
    }
  }
  return existentes;
}

// ============================================================================
// POST /api/abastecimentos/importar
// ============================================================================
export const importarAbastecimentos = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({
      error: 'Arquivo ausente',
      message: 'Envie uma planilha .xlsx, .xls ou .csv no campo `arquivo` (multipart/form-data).',
    });
  }

  let workbook;
  try {
    workbook = lerPlanilha(req.file);
  } catch (erro) {
    return res.status(422).json({
      error: 'Planilha invalida',
      message: `Nao foi possivel ler o arquivo: ${erro.message}`,
    });
  }

  const nomeAba = escolherAba(workbook, req.body?.aba);
  if (!nomeAba) {
    return res.status(422).json({
      error: 'Planilha vazia',
      message: 'O arquivo nao possui abas com dados.',
    });
  }

  let linhas;
  try {
    linhas = XLSX.utils.sheet_to_json(workbook.Sheets[nomeAba], {
      header: 1,
      defval: null,
      raw: true,
    });
  } catch (erro) {
    return res.status(422).json({
      error: 'Planilha invalida',
      message: `Nao foi possivel interpretar a aba "${nomeAba}": ${erro.message}`,
    });
  }

  if (linhas.length < 2) {
    return res.status(422).json({
      error: 'Planilha vazia',
      message: 'A planilha nao possui dados abaixo do cabecalho.',
    });
  }

  const indiceCabecalho = localizarCabecalho(linhas);
  const cabecalho = linhas[indiceCabecalho] || [];
  const colunas = mapearColunas(cabecalho);
  const faltando = CAMPOS_OBRIGATORIOS.filter((campo) => colunas[campo] < 0);

  if (faltando.length > 0) {
    return res.status(422).json({
      error: 'Colunas obrigatorias ausentes',
      message: `Nao encontrei: ${faltando.join(', ')}. Colunas lidas: ${cabecalho.map((c) => texto(c)).filter(Boolean).join(' | ')}`,
      colunas_lidas: cabecalho.map((c) => texto(c)).filter(Boolean),
      colunas_obrigatorias: CAMPOS_OBRIGATORIOS,
    });
  }

  const veiculosPorPlaca = await carregarVeiculosPorPlaca();
  const registros = [];
  const erros = [];
  const placasSemVeiculo = new Set();
  let linhasLidas = 0;
  let linhasVazias = 0;
  let linhasSemVeiculo = 0;

  for (let i = indiceCabecalho + 1; i < linhas.length; i += 1) {
    const linha = linhas[i] || [];
    if (linhaVazia(linha)) {
      linhasVazias += 1;
      continue;
    }
    linhasLidas += 1;
    const numeroLinha = i + 1;

    const placa = normalizarPlaca(valorDaLinha(linha, colunas.placa));
    if (!placa) {
      erros.push({ linha: numeroLinha, motivo: 'PLACA ausente.' });
      continue;
    }

    const dataTransacao = parseDataTransacao(valorDaLinha(linha, colunas.data_transacao));
    if (!dataTransacao) {
      erros.push({ linha: numeroLinha, motivo: 'DATA TRANSACAO invalida ou ausente.' });
      continue;
    }

    const tipoCombustivel = textoLimitado(valorDaLinha(linha, colunas.tipo_combustivel), 100);
    if (!tipoCombustivel) {
      erros.push({ linha: numeroLinha, motivo: 'TIPO COMBUSTIVEL ausente.' });
      continue;
    }

    const litros = parseNumero(valorDaLinha(linha, colunas.litros));
    if (litros === null || litros <= 0) {
      erros.push({ linha: numeroLinha, motivo: 'LITROS invalido ou ausente.' });
      continue;
    }

    const veiculo = veiculosPorPlaca.get(chavePlaca(placa));
    if (!veiculo) {
      linhasSemVeiculo += 1;
      placasSemVeiculo.add(placa);
    }

    const kmRodadosHoras = parseNumero(valorDaLinha(linha, colunas.km_rodados_horas));
    const kmPorLitroInformado = parseNumero(valorDaLinha(linha, colunas.km_por_litro));
    const kmPorLitro = kmPorLitroInformado !== null
      ? kmPorLitroInformado
      : (kmRodadosHoras !== null && kmRodadosHoras > 0
        ? arredondar(kmRodadosHoras / litros, 2)
        : null);

    registros.push({
      codigo_transacao: textoLimitado(valorDaLinha(linha, colunas.codigo_transacao), 100),
      forma_pagamento: textoLimitado(valorDaLinha(linha, colunas.forma_pagamento), 50),
      data_transacao: dataTransacao,
      placa,
      tag: veiculo?.tag ?? textoLimitado(valorDaLinha(linha, colunas.tag), 50),
      modelo_veiculo: veiculo?.modelo ?? textoLimitado(valorDaLinha(linha, colunas.modelo_veiculo), 100),
      nome_motorista: textoLimitado(valorDaLinha(linha, colunas.nome_motorista), 255),
      tipo_combustivel: tipoCombustivel.toUpperCase(),
      litros,
      hodometro_horimetro: parseNumero(valorDaLinha(linha, colunas.hodometro_horimetro)),
      km_rodados_horas: kmRodadosHoras,
      km_por_litro: kmPorLitro,
      emissao_co2_kg: calcularEmissaoCO2(litros, tipoCombustivel),
      estabelecimento: textoLimitado(valorDaLinha(linha, colunas.estabelecimento), 255),
      contrato: textoLimitado(valorDaLinha(linha, colunas.contrato), 100) ?? veiculo?.contrato ?? null,
      mes_referencia: mesReferencia(dataTransacao),
    });
  }

  // Evita duplicidade dentro do proprio arquivo e em reimportacoes futuras.
  // A chave inclui codigo + placa + data + litros: um mesmo codigo pode ser
  // reaproveitado pela matriz em linhas distintas sem perder lancamentos.
  const chavesVistas = new Set();
  const codigosVistos = new Set();
  const registrosUnicos = [];
  let duplicadosNoArquivo = 0;

  for (const registro of registros) {
    const chave = chaveRegistro(
      registro.codigo_transacao,
      registro.placa,
      registro.data_transacao,
      registro.litros,
    );
    if (chave && chavesVistas.has(chave)) {
      duplicadosNoArquivo += 1;
      continue;
    }
    if (chave) {
      chavesVistas.add(chave);
      codigosVistos.add(registro.codigo_transacao);
    }
    registrosUnicos.push(registro);
  }

  const chavesExistentes = codigosVistos.size > 0
    ? await buscarChavesExistentes(codigosVistos)
    : new Set();
  const novos = registrosUnicos.filter((registro) => {
    const chave = chaveRegistro(
      registro.codigo_transacao,
      registro.placa,
      registro.data_transacao,
      registro.litros,
    );
    return !chave || !chavesExistentes.has(chave);
  });
  const duplicadosNoBanco = registrosUnicos.length - novos.length;

  if (novos.length > 0) {
    const lotes = [];
    for (let i = 0; i < novos.length; i += TAMANHO_LOTE_INSERT) {
      lotes.push(novos.slice(i, i + TAMANHO_LOTE_INSERT));
    }
    await prisma.$transaction(
      lotes.map((data) => prisma.abastecimento.createMany({ data })),
    );
  }

  const totalLitros = novos.reduce((total, item) => total + item.litros, 0);
  const totalCo2 = novos.reduce((total, item) => total + (item.emissao_co2_kg || 0), 0);

  const resumo = {
    linhas_lidas: linhasLidas,
    linhas_vazias: linhasVazias,
    importados: novos.length,
    ignorados: erros.length,
    duplicados: duplicadosNoArquivo + duplicadosNoBanco,
    linhas_sem_veiculo: linhasSemVeiculo,
    total_litros: arredondar(totalLitros),
    total_co2_kg: arredondar(totalCo2),
    meses: [...new Set(novos.map((item) => item.mes_referencia))].sort(),
    placas_sem_veiculo: [...placasSemVeiculo].sort().slice(0, 50),
  };

  if (novos.length === 0 && registrosUnicos.length === 0) {
    return res.status(422).json({
      error: 'Nenhum registro importado',
      message: erros.length > 0
        ? 'Nenhuma linha valida foi encontrada na planilha.'
        : 'A planilha nao possui linhas de dados.',
      resumo,
      erros: erros.slice(0, LIMITE_ERROS_DETALHADOS),
    });
  }

  await registrarLogAtividade(req, {
    acao: 'IMPORTAR',
    modulo: 'Combustivel',
    detalhes: resumo,
  });

  return res.status(novos.length > 0 ? 201 : 200).json({
    mensagem: novos.length > 0
      ? `${novos.length} abastecimento(s) importado(s).`
      : 'Nenhum novo abastecimento importado (linhas duplicadas ou invalidas).',
    resumo,
    erros: erros.slice(0, LIMITE_ERROS_DETALHADOS),
  });
});

// ============================================================================
// GET /api/abastecimentos?mes=YYYY-MM&placa=&tag=&tipo_combustivel=
// ============================================================================
export const listarAbastecimentos = asyncHandler(async (req, res) => {
  const mes = texto(req.query.mes);
  if (mes && !MES_REGEX.test(mes)) {
    return res.status(400).json({
      error: 'Mes invalido',
      message: 'Informe o mes no formato AAAA-MM (ex.: 2026-08).',
    });
  }

  const where = {};
  if (mes) where.mes_referencia = mes;

  const placa = texto(req.query.placa);
  if (placa) {
    where.placa = { contains: normalizarPlaca(placa), mode: 'insensitive' };
  }

  const tag = texto(req.query.tag);
  if (tag) where.tag = tag;

  const tipoCombustivel = texto(req.query.tipo_combustivel || req.query.tipo);
  if (tipoCombustivel) {
    where.tipo_combustivel = { equals: tipoCombustivel.toUpperCase(), mode: 'insensitive' };
  }

  const limite = Math.min(
    Math.max(Number.parseInt(req.query.limite ?? req.query.limit ?? '500', 10) || 500, 1),
    2000,
  );
  const offset = Math.max(Number.parseInt(req.query.offset ?? '0', 10) || 0, 0);

  const [dados, total, agregado, grupos] = await comRetryConexao(
    () => Promise.all([
      prisma.abastecimento.findMany({
        where,
        orderBy: [{ data_transacao: 'desc' }, { created_at: 'desc' }],
        skip: offset,
        take: limite,
      }),
      prisma.abastecimento.count({ where }),
      prisma.abastecimento.aggregate({
        where,
        _sum: { litros: true, emissao_co2_kg: true, km_rodados_horas: true },
        _avg: { km_por_litro: true },
      }),
      prisma.abastecimento.groupBy({
        by: ['tipo_combustivel'],
        where,
        _count: { _all: true },
        _sum: { litros: true, emissao_co2_kg: true },
      }),
    ]),
    3,
    700,
    'abastecimentos',
  );

  const porCombustivel = grupos
    .map((grupo) => ({
      tipo_combustivel: grupo.tipo_combustivel,
      registros: grupo._count._all,
      litros: arredondar(grupo._sum.litros),
      co2_kg: arredondar(grupo._sum.emissao_co2_kg),
    }))
    .sort((a, b) => b.litros - a.litros);

  return res.json({
    mes: mes || null,
    dados,
    resumo: {
      total_registros: total,
      total_litros: arredondar(agregado._sum.litros),
      total_co2_kg: arredondar(agregado._sum.emissao_co2_kg),
      total_km_horas: arredondar(agregado._sum.km_rodados_horas),
      media_km_por_litro: agregado._avg.km_por_litro === null
        ? null
        : arredondar(agregado._avg.km_por_litro, 2),
      por_combustivel: porCombustivel,
    },
    paginacao: {
      total,
      limite,
      offset,
      tem_mais: offset + dados.length < total,
    },
  });
});

// ============================================================================
// GET /api/abastecimentos/meses
// ============================================================================
export const listarMeses = asyncHandler(async (req, res) => {
  const grupos = await comRetryConexao(
    () => prisma.abastecimento.groupBy({
      by: ['mes_referencia'],
      _count: { _all: true },
      _sum: { litros: true, emissao_co2_kg: true },
      orderBy: { mes_referencia: 'desc' },
    }),
    3,
    700,
    'abastecimentos',
  );

  return res.json({
    meses: grupos.map((grupo) => grupo.mes_referencia),
    detalhes: grupos.map((grupo) => ({
      mes: grupo.mes_referencia,
      registros: grupo._count._all,
      total_litros: arredondar(grupo._sum.litros),
      total_co2_kg: arredondar(grupo._sum.emissao_co2_kg),
    })),
  });
});

export {
  calcularEmissaoCO2,
  fatorEmissaoCO2,
  normalizarPlaca,
  parseDataTransacao,
  parseNumero,
};
