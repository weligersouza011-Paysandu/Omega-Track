import prisma from '../config/database.js';

// ============================================================================
// Manutenção preventiva — diagnóstico do odômetro por veículo.
// km_atual: última KM Final registrada (ou projeção informada).
// ============================================================================

export const KM_LIMITE_PREVENTIVA_PADRAO = 10000;
// Alerta "PROXIMO" quando restarem 10% (ou menos) do limite.
export const LIMIAR_ALERTA_PREVENTIVA = 0.1;

// Quilometragem: armazenada como texto livre, comparada como número.
// Retorna null quando ausente ou não numérica.
export function parseKm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Última km_final do veículo (por data, desempate por created_at).
export async function obterUltimaKmFinal(tagNormalizada, ignorarId = null) {
  const ultima = await prisma.parteDiaria.findFirst({
    where: {
      tag: tagNormalizada,
      deletado_em: null,
      veiculo: { deletado_em: null },
      ...(ignorarId ? { id: { not: String(ignorarId) } } : {}),
    },
    orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
    select: { id: true, tag: true, data: true, km_final: true, numero_relatorio: true, created_at: true },
  });
  return {
    ultima_km_final: parseKm(ultima?.km_final),
    parte_id: ultima?.id || null,
    data: ultima?.data || null,
    numero_relatorio: ultima?.numero_relatorio || null,
  };
}

// ============================================================================
// FASE 3 — Engine preditiva: média diária e projeção da próxima preventiva.
// Janela padrão de 30 dias; "dia útil" = seg–sáb (domingo fora da grade).
// ============================================================================

export const JANELA_MEDIA_DIAS = 30;
export const JANELA_LEITURA_DIAS = 60;

function somenteData(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Dias úteis (seg–sáb) entre duas datas, mínimo 1.
export function diasUteisEntre(inicio, fim) {
  let a = somenteData(inicio);
  const b = somenteData(fim);
  if (a > b) [a, b] = [b, a];
  let dias = 0;
  const cursor = new Date(a);
  while (cursor <= b) {
    if (cursor.getDay() !== 0) dias += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(dias, 1);
}

// Leituras (km_final numéricas, ordenadas) de um veículo na janela.
export async function leiturasRecentes(tagNormalizada, dias = JANELA_MEDIA_DIAS) {
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  desde.setDate(desde.getDate() - (dias - 1));
  const partes = await prisma.parteDiaria.findMany({
    where: { tag: tagNormalizada, deletado_em: null, veiculo: { deletado_em: null }, data: { gte: desde }, km_final: { not: null } },
    orderBy: [{ data: 'asc' }, { created_at: 'asc' }],
    select: { data: true, km_final: true, created_at: true },
  });
  return partes
    .map((p) => ({ data: p.data, km: parseKm(p.km_final) }))
    .filter((l) => l.km !== null);
}

// Média de km por dia útil na janela (null quando insuficiente/inconsistente).
export function mediaKmDia(leituras) {
  if (!Array.isArray(leituras) || leituras.length < 2) return null;
  const primeira = leituras[0];
  const ultima = leituras[leituras.length - 1];
  const deltaKm = ultima.km - primeira.km;
  if (!(deltaKm > 0)) return null;
  const dias = diasUteisEntre(primeira.data, ultima.data);
  if (dias < 1) return null;
  return Math.round((deltaKm / dias) * 10) / 10;
}

// Data prevista (dias corridos a partir de hoje; vencido => hoje).
export function dataPrevistaPreventiva(diasRestantes) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.max(diasRestantes || 0, 0));
  return d.toISOString().slice(0, 10);
}
// Resolve o limite aplicável com a tabela dinâmica de parâmetros.
// Precedência: categoria+contrato > categoria (global) > veículo > padrão 10000.
export async function resolverLimitePreventiva({ limiteVeiculo = null, categoria = null, contrato = null } = {}) {
  const cat = String(categoria || '').trim().toUpperCase();
  const cont = String(contrato || '').trim() || null;
  if (cat) {
    let p = null;
    if (cont) {
      p = await prisma.parametroPreventiva.findFirst({ where: { categoria: cat, contrato: cont } });
      if (p) return { km_limite: p.km_limite_preventiva, origem_limite: 'categoria+contrato', parametro_id: p.id };
    }
    p = await prisma.parametroPreventiva.findFirst({ where: { categoria: cat, contrato: null } });
    if (p) return { km_limite: p.km_limite_preventiva, origem_limite: 'categoria', parametro_id: p.id };
  }
  const lv = Number(limiteVeiculo);
  if (Number.isFinite(lv) && lv > 0) {
    return { km_limite: Math.trunc(lv), origem_limite: 'veiculo', parametro_id: null };
  }
  return { km_limite: KM_LIMITE_PREVENTIVA_PADRAO, origem_limite: 'padrao', parametro_id: null };
}

// ============================================================================
// FASE SÊNIOR 2 — Marco zero ancorado na última Parte Diária de preventiva.
// Precedência da âncora: parte preventiva (km_final) > registro manual do
// veículo (coluna) > 0. Sem leitura atual, não há o que acumular.
// ============================================================================

export const STATUS_PREVENTIVA = 'Manutenção Preventiva';

// Última Parte Diária de preventiva do veículo com km_final numérica.
export async function obterUltimaPartePreventiva(tagNormalizada) {
  const partes = await prisma.parteDiaria.findMany({
    where: { tag: tagNormalizada, deletado_em: null, veiculo: { deletado_em: null }, status_operacional: STATUS_PREVENTIVA },
    orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
    take: 10,
    select: { id: true, data: true, km_final: true, numero_relatorio: true, created_at: true },
  });
  for (const p of partes) {
    const km = parseKm(p.km_final);
    if (km !== null) {
      return { km_ultima_preventiva: km, parte_id: p.id, data: p.data, numero_relatorio: p.numero_relatorio };
    }
  }
  return null;
}

// Âncora do ciclo: parte preventiva > coluna manual > 0.
export async function resolverAncorasPreventiva(tagNormalizada, kmManualVeiculo = null) {
  const parte = await obterUltimaPartePreventiva(tagNormalizada);
  if (parte) {
    return { ...parte, origem_preventiva: 'parte_preventiva' };
  }
  const manual = parseKm(kmManualVeiculo);
  if (manual !== null) {
    return { km_ultima_preventiva: manual, parte_id: null, data: null, numero_relatorio: null, origem_preventiva: 'registro_manual' };
  }
  return { km_ultima_preventiva: 0, parte_id: null, data: null, numero_relatorio: null, origem_preventiva: 'zero' };
}

// Lote para a projeção da frota: última preventiva com KM por TAG (1 consulta).
export async function mapaUltimasPreventivas(tagsNormalizadas) {
  if (!tagsNormalizadas.length) return new Map();
  const partes = await prisma.parteDiaria.findMany({
    where: { tag: { in: tagsNormalizadas }, deletado_em: null, veiculo: { deletado_em: null }, status_operacional: STATUS_PREVENTIVA },
    orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
    select: { tag: true, id: true, data: true, km_final: true, numero_relatorio: true },
  });
  const mapa = new Map();
  for (const p of partes) {
    const chave = String(p.tag).toUpperCase();
    if (mapa.has(chave)) continue;
    const km = parseKm(p.km_final);
    if (km === null) continue;
    mapa.set(chave, { km_ultima_preventiva: km, parte_id: p.id, data: p.data, numero_relatorio: p.numero_relatorio });
  }
  return mapa;
}

// status_alerta: NORMAL | PROXIMO (<=10% do limite restante) | VENCIDO (<0).
export function calcularStatusManutencao({ kmAtual, kmUltimaPreventiva, kmLimite }) {
  const limite = Number.isFinite(Number(kmLimite)) && Number(kmLimite) > 0
    ? Number(kmLimite)
    : KM_LIMITE_PREVENTIVA_PADRAO;
  if (kmAtual === null || kmAtual === undefined) {
    return {
      km_limite_preventiva: limite,
      km_rodados_desde_preventiva: null,
      km_restantes_para_preventiva: null,
      percentual_uso: null,
      status_alerta: 'NORMAL',
      sem_leitura_atual: true,
      sem_registro_preventiva: kmUltimaPreventiva === null || kmUltimaPreventiva === undefined,
    };
  }
  if (kmUltimaPreventiva === null || kmUltimaPreventiva === undefined) {
    return {
      km_limite_preventiva: limite,
      km_rodados_desde_preventiva: null,
      km_restantes_para_preventiva: null,
      percentual_uso: null,
      status_alerta: 'NORMAL',
      sem_leitura_atual: false,
      sem_registro_preventiva: true,
    };
  }
  const rodados = kmAtual - kmUltimaPreventiva;
  const restantes = limite - rodados;
  return {
    km_limite_preventiva: limite,
    km_rodados_desde_preventiva: rodados,
    km_restantes_para_preventiva: restantes,
    percentual_uso: Math.round((rodados / limite) * 1000) / 10,
    status_alerta: restantes < 0 ? 'VENCIDO' : restantes <= limite * LIMIAR_ALERTA_PREVENTIVA ? 'PROXIMO' : 'NORMAL',
    sem_leitura_atual: false,
    sem_registro_preventiva: false,
  };
}
