// ============================================================================
// Auditoria de Pendencias de Lancamento Diario de Frota.
// Pendencia = veiculo ativo/mobilizado SEM Parte Diaria em um dia da grade
// (seg–sab) dentro do periodo auditado. A pendencia e DERIVADA: criar a Parte
// Diaria do dia/data da baixa automatica. O descarte manual (ADM/Transporte)
// fica persistido em `pendencias_parte_diaria_ignoradas` e o override manual
// do operador responsavel fica em `pendencias_parte_diaria_operador`.
// Visao: ADMINISTRADOR (Master/Transporte/Gestao) ve tudo; OPERACIONAL ve
// apenas as pendencias vinculadas ao ultimo operador do veiculo.
//
// Filtros da query (prioridade de resolucao):
//   1) datas=2026-10-16,2026-10-15   -> audita exatamente estas datas;
//   2) dataInicio=...&dataFim=...    -> intervalo inclusivo (max 31 dias);
//   3) dias=N                        -> janela de N dias terminando em D-1;
//   4) (nenhum)                      -> dia util anterior (D-1, pula domingo).
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { sessaoOperacional, atuanteDaRequisicao } from '../middleware/sessao.js';

const DIAS_AUDITORIA_PADRAO = 7;
const DIAS_AUDITORIA_MAX = 31;
// Historico consultado para achar o ultimo operador antes da janela.
const HISTORICO_DIAS = 60;

// Datas de calendario no fuso da operacao (UTC-3), sem deslocamento de dia.
function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function somarDiasISO(iso, delta) {
  const [ano, mes, dia] = String(iso).split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + delta));
  return d.toISOString().slice(0, 10);
}

function isoParaData(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoDeData(valor) {
  return valor instanceof Date
    ? valor.toISOString().slice(0, 10)
    : String(valor || '').slice(0, 10);
}

function eDomingo(iso) {
  const [ano, mes, dia] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay() === 0;
}

function eISOValida(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '').trim());
}

// Dia util (seg–sab) imediatamente anterior a `iso`.
function diaUtilAnterior(iso) {
  let d = somarDiasISO(iso, -1);
  while (eDomingo(d)) d = somarDiasISO(d, -1);
  return d;
}

function normalizar(v) {
  return String(v || '').trim().toUpperCase();
}

// Normaliza `datas` vindo como string ("a,b"), array repetido ou array JSON.
function parseListaDatas(bruto) {
  if (bruto === undefined || bruto === null) return [];
  const itens = Array.isArray(bruto)
    ? bruto.flatMap((d) => String(d).split(','))
    : String(bruto).split(',');
  return [...new Set(itens.map((d) => d.trim()).filter(Boolean))];
}

// Resolve o periodo auditado a partir da query string.
// Retorna { erro } quando os parametros sao invalidos.
function resolverPeriodo(query) {
  const listaDatas = parseListaDatas(query.datas ?? query['datas[]']);
  if (listaDatas.length) {
    if (listaDatas.length > DIAS_AUDITORIA_MAX) {
      return { erro: `Selecione no máximo ${DIAS_AUDITORIA_MAX} datas.` };
    }
    const invalida = listaDatas.find((d) => !eISOValida(d));
    if (invalida) {
      return { erro: `Data inválida em \`datas\`: "${invalida}". Use YYYY-MM-DD.` };
    }
    const datas = listaDatas.filter((d) => !eDomingo(d)).sort();
    return { datas, modo: 'datas' };
  }

  const dataInicio = String(query.dataInicio || '').trim();
  const dataFim = String(query.dataFim || '').trim();
  if (dataInicio && !eISOValida(dataInicio)) {
    return { erro: 'Data inválida em `dataInicio`. Use YYYY-MM-DD.' };
  }
  if (dataFim && !eISOValida(dataFim)) {
    return { erro: 'Data inválida em `dataFim`. Use YYYY-MM-DD.' };
  }

  // Modo intervalo (D-1 como limite superior quando só um lado é enviado).
  if (dataInicio || dataFim) {
    const ontem = somarDiasISO(hojeISO(), -1);
    let inicio = dataInicio || somarDiasISO(dataFim, -(DIAS_AUDITORIA_PADRAO - 1));
    let fim = dataFim || (dataInicio && dataInicio < ontem ? ontem : dataInicio || ontem);
    if (inicio > fim) [inicio, fim] = [fim, inicio];
    // Janela máxima de 31 dias: ancora no fim e puxa o início.
    if (somarDiasISO(inicio, DIAS_AUDITORIA_MAX - 1) < fim) {
      inicio = somarDiasISO(fim, -(DIAS_AUDITORIA_MAX - 1));
    }
    const datas = [];
    for (let d = inicio; d <= fim; d = somarDiasISO(d, 1)) {
      if (!eDomingo(d)) datas.push(d);
    }
    return { datas, modo: 'intervalo' };
  }

  // Modo janela: `dias=N` terminando em D-1 (padrão 7).
  const diasParam = Number(query.dias);
  if (query.dias !== undefined && Number.isFinite(diasParam) && diasParam > 1) {
    const janela = Math.min(Math.max(Math.trunc(diasParam), 1), DIAS_AUDITORIA_MAX);
    const fim = somarDiasISO(hojeISO(), -1);
    const inicio = somarDiasISO(fim, -(janela - 1));
    const datas = [];
    for (let d = inicio; d <= fim; d = somarDiasISO(d, 1)) {
      if (!eDomingo(d)) datas.push(d);
    }
    return { datas, modo: 'janela' };
  }

  // Padrao: dia util imediatamente anterior (D-1, pulando domingo).
  return { datas: [diaUtilAnterior(hojeISO())], modo: 'dia_anterior' };
}

export const listarPendencias = asyncHandler(async (req, res) => {
  // Escopo: admin ve tudo; operacional ve apenas as proprias.
  const atuante = await atuanteDaRequisicao(req);
  const operacional = sessaoOperacional(req);
  if (!atuante && !operacional) {
    return res.status(401).json({
      error: 'Nao autenticado',
      message: 'Sessao ausente ou invalida. Faca login.',
    });
  }

  const periodo = resolverPeriodo(req.query);
  if (periodo.erro) {
    return res.status(400).json({ error: 'Parametros invalidos', message: periodo.erro });
  }
  const diasAuditados = periodo.datas;
  if (!diasAuditados.length) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.json({ data: [], meta: { modo: periodo.modo, datas: [], inicio: null, fim: null, total: 0 } });
  }
  const inicioISO = diasAuditados[0];
  const fimISO = diasAuditados[diasAuditados.length - 1];
  const inicioData = isoParaData(inicioISO);
  const fimData = isoParaData(fimISO);

  // Passo A: frota ativa/mobilizada.
  const veiculos = await prisma.mobDesmob.findMany({
    where: { status: { not: 'Desmobilizado' } },
    select: { tag: true, placa: true, data_mob: true, data_desmob: true },
  });
  const tagsFrota = veiculos.map((v) => v.tag);

  // Passo B: partes diarias da janela (presenca por veiculo/dia + timeline)
  // + pendencias descartadas + overrides de operador responsavel.
  const [partesJanela, ignoradas, overrides] = await Promise.all([
    tagsFrota.length
      ? prisma.parteDiaria.findMany({
        where: { tag: { in: tagsFrota }, data: { gte: inicioData, lte: fimData } },
        select: { tag: true, data: true, funcionario: true, operador: true, criado_por: true },
        orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
      })
      : Promise.resolve([]),
    prisma.pendenciaParteDiariaIgnorada.findMany({
      where: { data: { gte: inicioData, lte: fimData } },
      select: { tag: true, data: true },
    }),
    prisma.pendenciaParteDiariaOperador.findMany({
      where: { data: { gte: inicioData, lte: fimData } },
      select: { tag: true, data: true, operador_id: true, operador_nome: true, operador_matricula: true },
    }),
  ]);

  const presentes = new Map(); // TAG -> Set(dia ISO)
  const timeline = new Map(); // TAG -> [{ iso, funcionario, operador, criado_por }] (desc)
  for (const p of partesJanela) {
    const tag = normalizar(p.tag);
    if (!presentes.has(tag)) presentes.set(tag, new Set());
    presentes.get(tag).add(isoDeData(p.data));
    if (!timeline.has(tag)) timeline.set(tag, []);
    timeline.get(tag).push({
      iso: isoDeData(p.data),
      funcionario: p.funcionario,
      operador: p.operador,
      criado_por: p.criado_por,
    });
  }
  const descartadas = new Set(ignoradas.map((i) => `${normalizar(i.tag)}|${isoDeData(i.data)}`));
  const overridePorTagDia = new Map(
    overrides.map((o) => [`${normalizar(o.tag)}|${isoDeData(o.data)}`, o]),
  );

  // Passo C: candidatos (veiculo x dia sem lancamento e sem descarte).
  const candidatos = [];
  for (const v of veiculos) {
    const tagNorm = normalizar(v.tag);
    const presentesTag = presentes.get(tagNorm) || new Set();
    const mobISO = v.data_mob ? isoDeData(v.data_mob) : null;
    const desmobISO = v.data_desmob ? isoDeData(v.data_desmob) : null;
    for (const dia of diasAuditados) {
      if (mobISO && mobISO > dia) continue; // ainda nao mobilizado
      if (desmobISO && desmobISO < dia) continue; // ja desmobilizado
      if (presentesTag.has(dia)) continue;
      if (descartadas.has(`${tagNorm}|${dia}`)) continue;
      candidatos.push({ tag: v.tag, tagNorm, placa: v.placa, dia });
    }
  }

  if (candidatos.length) {
    // Historico anterior a janela (ultimo operador responsavel).
    const tagsOriginais = [...new Set(candidatos.map((c) => c.tag))];
    const historico = await prisma.parteDiaria.findMany({
      where: {
        tag: { in: tagsOriginais },
        data: { gte: isoParaData(somarDiasISO(inicioISO, -HISTORICO_DIAS)), lt: inicioData },
      },
      select: { tag: true, data: true, funcionario: true, operador: true, criado_por: true },
      orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
    });
    for (const p of historico) {
      const tag = normalizar(p.tag);
      if (!timeline.has(tag)) timeline.set(tag, []);
      timeline.get(tag).push({
        iso: isoDeData(p.data),
        funcionario: p.funcionario,
        operador: p.operador,
        criado_por: p.criado_por,
      });
    }
  }

  const fallbackCache = new Map(); // TAG -> Promise(registro|null)
  const ultimoAntes = (candidato) => {
    const lista = timeline.get(candidato.tagNorm) || [];
    const emMemoria = lista.find((r) => r.iso < candidato.dia);
    if (emMemoria) return Promise.resolve(emMemoria);
    if (fallbackCache.has(candidato.tagNorm)) return fallbackCache.get(candidato.tagNorm);
    const busca = prisma.parteDiaria
      .findFirst({
        where: { tag: candidato.tag, data: { lt: isoParaData(candidato.dia) } },
        select: { data: true, funcionario: true, operador: true, criado_por: true },
        orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
      })
      .then((r) => (r ? { iso: isoDeData(r.data), funcionario: r.funcionario, operador: r.operador, criado_por: r.criado_por } : null))
      .catch(() => null);
    fallbackCache.set(candidato.tagNorm, busca);
    return busca;
  };

  // Resolve o autor da PD mais recente anterior a cada dia pendente.
  const usuarios = await prisma.usuario.findMany({
    select: { id: true, matricula: true, nome: true },
  });
  const usuarioPorMatricula = new Map(
    usuarios.filter((u) => u.matricula).map((u) => [normalizar(u.matricula), u]),
  );

  const itens = [];
  for (const c of candidatos) {
    const ultimo = await ultimoAntes(c);
    const usuarioAutor = ultimo?.operador ? usuarioPorMatricula.get(normalizar(ultimo.operador)) : null;
    const item = {
      id: `${c.tagNorm}|${c.dia}`,
      veiculo_id: c.tag,
      tag: c.tag,
      placa: c.placa,
      data_pendente: c.dia,
      ultimo_operador_id: usuarioAutor?.id || null,
      ultimo_operador_nome: ultimo?.funcionario || ultimo?.criado_por || usuarioAutor?.nome || null,
      ultimo_operador_matricula: ultimo?.operador || usuarioAutor?.matricula || null,
      ultima_parte_data: ultimo?.iso || null,
      operador_editado: false,
    };
    // Override manual do ADM: prevalece sobre o operador derivado.
    const ov = overridePorTagDia.get(`${c.tagNorm}|${c.dia}`);
    if (ov) {
      item.ultimo_operador_id = ov.operador_id || null;
      item.ultimo_operador_nome = ov.operador_nome || item.ultimo_operador_nome;
      item.ultimo_operador_matricula = ov.operador_matricula || item.ultimo_operador_matricula;
      item.operador_editado = true;
    }
    itens.push(item);
  }
  itens.sort((a, b) => (a.data_pendente === b.data_pendente
    ? a.tag.localeCompare(b.tag, 'pt-BR')
    : b.data_pendente.localeCompare(a.data_pendente)));

  // Operacional: somente pendencias do proprio usuario (autor da ultima PD
  // ou operador definido manualmente pelo ADM na pendencia).
  let visiveis = itens;
  if (!atuante && operacional) {
    const usuarioLogado = usuarioPorMatricula.get(normalizar(operacional.matricula)) || null;
    const nomeLogado = normalizar(operacional.nome);
    visiveis = itens.filter((it) => {
      if (usuarioLogado?.id && it.ultimo_operador_id === usuarioLogado.id) return true;
      if (normalizar(it.ultimo_operador_matricula) === normalizar(operacional.matricula)) return true;
      const nome = normalizar(it.ultimo_operador_nome);
      if (nomeLogado && nome && (nome.includes(nomeLogado) || nomeLogado.includes(nome))) return true;
      return false;
    });
  }

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    data: visiveis,
    meta: {
      modo: periodo.modo,
      inicio: inicioISO,
      fim: fimISO,
      datas: diasAuditados,
      total: visiveis.length,
    },
  });
});

// Extrai a pendencia alvo de qualquer formato de rota/corpo:
//   - DELETE /pendencias/:tag/:data
//   - DELETE /pendencias/:id            (id = "TAG|YYYY-MM-DD", URL-encoded)
//   - PATCH  /pendencias/trocar-operador { id | tag + data }
function extrairTagData(req) {
  let tag = String(req.params.tag || req.body?.tag || '').trim();
  let dataISO = String(req.params.data || req.body?.data || '').trim();
  const idBruto = String(req.params.id || req.body?.id || req.query?.id || '').trim();
  if ((!tag || !dataISO) && idBruto) {
    const [t, d] = idBruto.split('|');
    tag = (t || '').trim();
    dataISO = (d || '').trim();
  }
  return { tag, dataISO: dataISO.slice(0, 10) };
}

// Descarte manual (ADM/Transporte): persiste a pendencia como ignorada.
export const ignorarPendencia = asyncHandler(async (req, res) => {
  const { tag, dataISO } = extrairTagData(req);
  if (!tag || !eISOValida(dataISO)) {
    return res.status(400).json({
      error: 'Parametros invalidos',
      message: 'Informe a TAG do veiculo e a data no formato YYYY-MM-DD (ou o id "TAG|YYYY-MM-DD").',
    });
  }
  const dataRef = isoParaData(dataISO);
  const motivo = String(req.body?.motivo || '').trim() || null;
  const ignoradoPor = req.atuante?.nome || String(req.body?.ignorado_por || '').trim() || null;

  const registro = await prisma.pendenciaParteDiariaIgnorada.upsert({
    where: { tag_data: { tag, data: dataRef } },
    create: { tag, data: dataRef, motivo, ignorado_por: ignoradoPor },
    update: { motivo, ignorado_por: ignoradoPor },
  });

  res.json({
    data: {
      id: `${normalizar(tag)}|${dataISO}`,
      tag: registro.tag,
      data_pendente: dataISO,
      ignorada: true,
      ignorado_por: registro.ignorado_por,
    },
  });
});

// PATCH /api/partes-diarias/pendencias/trocar-operador (ADM/Transporte).
// Altera manualmente o operador responsavel exibido na pendencia (override)
// ou remove o override quando nenhum dado e enviado (volta ao derivado).
export const trocarOperadorPendencia = asyncHandler(async (req, res) => {
  const { tag, dataISO } = extrairTagData(req);
  if (!tag || !eISOValida(dataISO)) {
    return res.status(400).json({
      error: 'Parametros invalidos',
      message: 'Informe a TAG do veiculo e a data no formato YYYY-MM-DD (ou o id "TAG|YYYY-MM-DD").',
    });
  }
  const corpo = req.body || {};
  let operadorId = corpo.operador_id !== undefined && corpo.operador_id !== '' && corpo.operador_id !== null
    ? String(corpo.operador_id).trim()
    : null;
  let nome = corpo.operador_nome !== undefined
    ? String(corpo.operador_nome || '').trim() || null
    : (corpo.nome !== undefined ? String(corpo.nome || '').trim() || null : null);
  let matricula = corpo.operador_matricula !== undefined
    ? String(corpo.operador_matricula || '').trim() || null
    : (corpo.matricula !== undefined ? String(corpo.matricula || '').trim() || null : null);

  if (operadorId) {
    const uuidValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operadorId);
    if (!uuidValido) {
      return res.status(400).json({
        error: 'Operador invalido',
        message: '`operador_id` deve ser o UUID de um usuario cadastrado.',
      });
    }
    const usuario = await prisma.usuario.findUnique({ where: { id: operadorId } });
    if (!usuario) {
      return res.status(400).json({
        error: 'Operador invalido',
        message: 'Usuario nao encontrado para o `operador_id` informado.',
      });
    }
    nome = nome || usuario.nome || null;
    matricula = matricula || usuario.matricula || null;
  }

  const dataRef = isoParaData(dataISO);
  const atualizadoPor = req.atuante?.nome || null;

  // Sem operador informado: remove o override (pendencia volta ao derivado).
  if (!operadorId && !nome && !matricula) {
    await prisma.pendenciaParteDiariaOperador.deleteMany({ where: { tag, data: dataRef } });
    return res.json({
      data: {
        id: `${normalizar(tag)}|${dataISO}`,
        tag,
        data_pendente: dataISO,
        operador_editado: false,
        ultimo_operador_id: null,
        ultimo_operador_nome: null,
        ultimo_operador_matricula: null,
      },
    });
  }

  const registro = await prisma.pendenciaParteDiariaOperador.upsert({
    where: { tag_data: { tag, data: dataRef } },
    create: {
      tag, data: dataRef, operador_id: operadorId, operador_nome: nome,
      operador_matricula: matricula, atualizado_por: atualizadoPor,
    },
    update: {
      operador_id: operadorId, operador_nome: nome,
      operador_matricula: matricula, atualizado_por: atualizadoPor,
    },
  });

  res.json({
    data: {
      id: `${normalizar(tag)}|${dataISO}`,
      tag,
      data_pendente: dataISO,
      operador_editado: true,
      ultimo_operador_id: registro.operador_id,
      ultimo_operador_nome: registro.operador_nome,
      ultimo_operador_matricula: registro.operador_matricula,
    },
  });
});
