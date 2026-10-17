// Formatacao de datas sem deslocamento de fuso (UTC-3).
// O backend entrega o campo `data` (Postgres DATE via Prisma) como
// 'YYYY-MM-DD' ou ISO completo ('YYYY-MM-DDT00:00:00.000Z'). Extraimos
// ano/mes/dia direto da string para que tabela, formulario e PDF exibam
// rigorosamente o mesmo dia, sem o recuo de um dia causado por
// new Date(...).toLocaleDateString() em horario local.

// Extrai { ano, mes, dia } da string (ISO, pt-BR ou Date serializavel).
export function extrairPartesData(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  // ISO: 'YYYY-MM-DD' ou 'YYYY-MM-DDT...'
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { ano: m[1], mes: m[2], dia: m[3] };
  // pt-BR: 'DD/MM/YYYY'
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return { ano: m[3], mes: m[2], dia: m[1] };
  // Ultimo recurso: Date serializavel (ex.: 'Oct 13 2026') no calendario local.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return {
    ano: String(d.getFullYear()),
    mes: String(d.getMonth() + 1).padStart(2, '0'),
    dia: String(d.getDate()).padStart(2, '0'),
  };
}

// 'DD/MM/YYYY' para exibicao (tabela, modais, relatorios).
export function formatarDataSemTimezone(valor) {
  const p = extrairPartesData(valor);
  return p ? `${p.dia}/${p.mes}/${p.ano}` : '—';
}

// Alias pedido na especificacao da tabela de listagem.
export const formatarDataBR = formatarDataSemTimezone;

// 'YYYY-MM-DD' para <input type="date"> e payloads (sem conversao de fuso).
export function paraInputData(valor) {
  const p = extrairPartesData(valor);
  return p ? `${p.ano}-${p.mes}-${p.dia}` : hojeISO();
}

// Data de hoje no calendario local (evita virar o dia apos 21h em UTC-3).
export function hojeISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}
