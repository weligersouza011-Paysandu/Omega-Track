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
    where: { tag: tagNormalizada, data: { gte: desde }, km_final: { not: null } },
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
