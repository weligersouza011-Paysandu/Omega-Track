// ============================================================================
// src/utils/semanasTelemetria.js — Semanas do ano (ISO 8601, segunda a domingo)
// no horário de Brasília/Pará (-03:00), usadas no filtro da Telemetria.
// Chave da semana: "AAAA-SS" (ex.: "2026-45").
// ============================================================================

const DIA_MS = 24 * 60 * 60 * 1000;
const FUSO_MS = -3 * 60 * 60 * 1000;

/** Semana ISO da data (no fuso -03:00): { ano, semana, chave }. */
export function semanaISO(data) {
  const local = new Date(new Date(data).getTime() + FUSO_MS);
  const dia = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const diaSemana = (new Date(dia).getUTCDay() + 6) % 7; // segunda = 0
  const quinta = dia + (3 - diaSemana) * DIA_MS; // a quinta-feira define o ano ISO
  const ano = new Date(quinta).getUTCFullYear();
  const semana = 1 + Math.floor((quinta - Date.UTC(ano, 0, 1)) / (7 * DIA_MS));
  return { ano, semana, chave: `${ano}-${String(semana).padStart(2, '0')}` };
}

/** Início (segunda 00:00 -03:00) e fim exclusivo (segunda seguinte) da semana "AAAA-SS". */
export function intervaloDaSemana(chave) {
  const m = String(chave).match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const semana = Number(m[2]);
  if (semana < 1 || semana > 53) return null;
  const jan4 = Date.UTC(ano, 0, 4);
  const segundaS1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DIA_MS;
  const segunda = segundaS1 + (semana - 1) * 7 * DIA_MS;
  // Semana 53 só existe em alguns anos: confere se a segunda cai mesmo nessa semana.
  if (semanaISO(new Date(segunda - FUSO_MS)).chave !== `${ano}-${String(semana).padStart(2, '0')}`) return null;
  return { chave: `${ano}-${String(semana).padStart(2, '0')}`, inicio: new Date(segunda - FUSO_MS), fim: new Date(segunda + 7 * DIA_MS - FUSO_MS) };
}

/** "2026-44,2026-45" ou lista -> intervalos ordenados (null quando vazio; lança Error se inválido). */
export function lerSemanas(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const chaves = [...new Set((Array.isArray(valor) ? valor : String(valor).split(',')).map((s) => String(s).trim()).filter(Boolean))];
  if (!chaves.length) return null;
  if (chaves.length > 60) throw new Error('Selecione no maximo 60 semanas.');
  const intervalos = chaves.map((c) => {
    const i = intervaloDaSemana(c);
    if (!i) throw new Error(`Semana invalida: "${c}". Use AAAA-SS (ex.: 2026-45).`);
    return i;
  }).sort((a, b) => a.inicio - b.inicio);
  return {
    intervalos,
    inicio: intervalos[0].inicio,
    fim: intervalos[intervalos.length - 1].fim,
    contem: (data) => intervalos.some((i) => new Date(data) >= i.inicio && new Date(data) < i.fim),
  };
}

/** As mesmas semanas deslocadas N semanas para trás (base de comparação dos KPIs). */
export function semanasAnteriores(intervalos) {
  const n = intervalos.length;
  return intervalos.map((i) => semanaISO(new Date(i.inicio.getTime() - n * 7 * DIA_MS)).chave);
}
