// ============================================================================
// Auditoria de Pendencias de Lancamento Diario de Frota.
// Pendencia = veiculo ativo/mobilizado SEM Parte Diaria em um dia da grade
// (seg–sab) dentro da janela auditada. A pendencia e DERIVADA: criar a Parte
// Diaria do dia/data da baixa automatica; o descarte manual (ADM/Transporte)
// fica persistido em `pendencias_parte_diaria_ignoradas`.
// Visao: ADMINISTRADOR (Master/Transporte/Gestao) ve tudo; OPERACIONAL ve
// apenas as pendencias vinculadas ao ultimo operador do veiculo.
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

function normalizar(v) {
  return String(v || '').trim().toUpperCase();
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

  const diasParam = Number(req.query.dias);
  const janelaDias = Number.isFinite(diasParam)
    ? Math.min(Math.max(Math.trunc(diasParam), 1), DIAS_AUDITORIA_MAX)
    : DIAS_AUDITORIA_PADRAO;
  const fimISO = hojeISO();
  const inicioISO = somarDiasISO(fimISO, -(janelaDias - 1));
  const inicioData = isoParaData(inicioISO);
  const fimData = isoParaData(fimISO);

  // Grade seg–sab: domingo nao gera pendencia.
  const diasAuditados = [];
  for (let i = 0; i < janelaDias; i += 1) {
    const iso = somarDiasISO(inicioISO, i);
    if (!eDomingo(iso)) diasAuditados.push(iso);
  }

  // Passo A: frota ativa/mobilizada.
  const veiculos = await prisma.mobDesmob.findMany({
    where: { status: { not: 'Desmobilizado' } },
    select: { tag: true, placa: true, data_mob: true, data_desmob: true },
  });
  const tagsFrota = veiculos.map((v) => v.tag);

  // Passo B: partes diarias da janela (presenca por veiculo/dia + timeline).
  const [partesJanela, ignoradas] = await Promise.all([
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
        data: { gte: somarDiasISO(inicioISO, -HISTORICO_DIAS), lt: inicioData },
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
    itens.push({
      id: `${c.tagNorm}|${c.dia}`,
      veiculo_id: c.tag,
      tag: c.tag,
      placa: c.placa,
      data_pendente: c.dia,
      ultimo_operador_id: usuarioAutor?.id || null,
      ultimo_operador_nome: ultimo?.funcionario || ultimo?.criado_por || usuarioAutor?.nome || null,
      ultimo_operador_matricula: ultimo?.operador || usuarioAutor?.matricula || null,
      ultima_parte_data: ultimo?.iso || null,
    });
  }
  itens.sort((a, b) => (a.data_pendente === b.data_pendente
    ? a.tag.localeCompare(b.tag, 'pt-BR')
    : b.data_pendente.localeCompare(a.data_pendente)));

  // Operacional: somente pendencias do proprio usuario (autor da ultima PD).
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
      janela_dias: janelaDias,
      inicio: inicioISO,
      fim: fimISO,
      total: visiveis.length,
    },
  });
});

// Descarte manual (ADM/Transporte): persiste a pendencia como ignorada.
export const ignorarPendencia = asyncHandler(async (req, res) => {
  const tag = String(req.params.tag || '').trim();
  const dataISO = String(req.params.data || '').trim();
  if (!tag || !/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) {
    return res.status(400).json({
      error: 'Parametros invalidos',
      message: 'Informe a TAG do veiculo e a data no formato YYYY-MM-DD.',
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
      id: registro.id,
      tag: registro.tag,
      data_pendente: dataISO,
      ignorada: true,
      ignorado_por: registro.ignorado_por,
    },
  });
});
