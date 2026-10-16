import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { KM_LIMITE_PREVENTIVA_PADRAO } from '../services/manutencaoService.js';

// ============================================================================
// Parâmetros de preventiva por categoria (modelo) e contrato.
// Escrita restrita (rotas): Gestão/Transporte ou ADM Master.
// ============================================================================

export function normalizarCategoria(v) {
  return String(v || '').trim().toUpperCase();
}

export function normalizarContrato(v) {
  const s = String(v || '').trim();
  return s === '' ? null : s;
}

// `km_limite_preventiva` estritamente inteiro positivo (> 0).
export function validarLimitePreventiva(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : v;
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error('`km_limite_preventiva` deve ser um número inteiro maior que zero.');
    err.statusCode = 400;
    throw err;
  }
  return n;
}

// GET /api/parametros-preventiva — lista todos (aberto).
export const listarParametros = asyncHandler(async (req, res) => {
  const parametros = await prisma.parametroPreventiva.findMany({
    orderBy: [{ categoria: 'asc' }, { contrato: 'asc' }],
  });
  res.json({ data: parametros, meta: { padrao_km: KM_LIMITE_PREVENTIVA_PADRAO } });
});

// GET /api/parametros-preventiva/categoria/:tipo?contrato= — limite aplicável.
export const buscarPorCategoria = asyncHandler(async (req, res) => {
  const categoria = normalizarCategoria(req.params.tipo);
  if (!categoria) {
    return res.status(400).json({ error: 'Categoria obrigatoria', message: 'Informe a categoria do veículo.' });
  }
  const contrato = normalizarContrato(req.query.contrato);
  let parametro = null;
  let origem = 'padrao';
  if (contrato) {
    parametro = await prisma.parametroPreventiva.findFirst({ where: { categoria, contrato } });
    if (parametro) origem = 'categoria+contrato';
  }
  if (!parametro) {
    parametro = await prisma.parametroPreventiva.findFirst({ where: { categoria, contrato: null } });
    if (parametro) origem = 'categoria';
  }
  res.json({
    data: {
      categoria,
      contrato,
      km_limite_preventiva: parametro?.km_limite_preventiva ?? KM_LIMITE_PREVENTIVA_PADRAO,
      origem,
      parametro_id: parametro?.id || null,
    },
  });
});

// POST /api/parametros-preventiva — cria ou atualiza (upsert por categoria+contrato).
export const salvarParametro = asyncHandler(async (req, res) => {
  const categoria = normalizarCategoria(req.body?.categoria);
  if (!categoria) {
    return res.status(400).json({ error: 'Categoria obrigatoria', message: 'Informe a categoria/tipo do veículo.' });
  }
  const km_limite_preventiva = validarLimitePreventiva(req.body?.km_limite_preventiva);
  const contrato = normalizarContrato(req.body?.contrato);

  const existente = await prisma.parametroPreventiva.findFirst({ where: { categoria, contrato } });
  let parametro;
  let criado = false;
  if (existente) {
    parametro = await prisma.parametroPreventiva.update({
      where: { id: existente.id },
      data: { km_limite_preventiva },
    });
  } else {
    parametro = await prisma.parametroPreventiva.create({
      data: { categoria, km_limite_preventiva, contrato },
    });
    criado = true;
  }
  res.status(criado ? 201 : 200).json({ data: parametro });
});

// DELETE /api/parametros-preventiva/:id — remove regra (volta ao padrão).
export const removerParametro = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existente = await prisma.parametroPreventiva.findUnique({ where: { id } });
  if (!existente) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Parâmetro não encontrado.' });
  }
  await prisma.parametroPreventiva.delete({ where: { id } });
  res.status(204).send();
});
