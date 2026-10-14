// ============================================================================
// src/controllers/obraController.js — Gestão de Obras
// Cadastro que alimenta o dropdown de Obra da Parte Diária (autofill de
// contrato, contratante, gestão/responsável e planejador).
// Leitura aberta; escrita restrita a Gestão/Transporte ou ADM Master.
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';

function paraApi(o) {
  if (!o) return o;
  const { _count, ...resto } = o;
  return {
    id: resto.id,
    nome: resto.nome,
    numeroContrato: resto.numero_contrato,
    contratante: resto.contratante,
    gestao: resto.gestao,
    planejador: resto.planejador,
    ativo: resto.ativo,
    totalPartes: _count?.partes_diarias ?? undefined,
    createdAt: resto.created_at,
    updatedAt: resto.updated_at,
  };
}

function strOuNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export const listarObras = asyncHandler(async (req, res) => {
  const { q, ativo, page = 1, limit = 100 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where = {};
  if (ativo === 'true') where.ativo = true;
  if (ativo === 'false') where.ativo = false;
  if (q && String(q).trim()) {
    const termo = String(q).trim();
    where.OR = [
      { nome: { contains: termo, mode: 'insensitive' } },
      { numero_contrato: { contains: termo, mode: 'insensitive' } },
      { contratante: { contains: termo, mode: 'insensitive' } },
      { gestao: { contains: termo, mode: 'insensitive' } },
      { planejador: { contains: termo, mode: 'insensitive' } },
    ];
  }

  const [obras, total] = await Promise.all([
    prisma.obra.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      include: { _count: { select: { partes_diarias: true } } },
    }),
    prisma.obra.count({ where }),
  ]);

  res.json({
    data: obras.map(paraApi),
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

export const buscarObra = asyncHandler(async (req, res) => {
  const obra = await prisma.obra.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { partes_diarias: true } } },
  });
  if (!obra) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Obra nao encontrada.' });
  }
  res.json({ data: paraApi(obra) });
});

export const criarObra = asyncHandler(async (req, res) => {
  const { nome, numeroContrato, contratante, gestao, planejador, ativo } = req.body || {};

  if (!nome || !String(nome).trim()) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'O campo nome da obra e obrigatorio.',
    });
  }

  const obra = await prisma.obra.create({
    data: {
      nome: String(nome).trim(),
      numero_contrato: strOuNull(numeroContrato),
      contratante: strOuNull(contratante) || 'Vale',
      gestao: strOuNull(gestao),
      planejador: strOuNull(planejador),
      ativo: ativo === undefined || ativo === null ? true : Boolean(ativo),
    },
  });

  res.status(201).json({ data: paraApi(obra) });
});

export const atualizarObra = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nome, numeroContrato, contratante, gestao, planejador, ativo } = req.body || {};

  const atual = await prisma.obra.findUnique({ where: { id } });
  if (!atual) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Obra nao encontrada.' });
  }
  if (nome !== undefined && !String(nome).trim()) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'O campo nome da obra e obrigatorio.',
    });
  }

  const dados = {};
  if (nome !== undefined) dados.nome = String(nome).trim();
  if (numeroContrato !== undefined) dados.numero_contrato = strOuNull(numeroContrato);
  if (contratante !== undefined) dados.contratante = strOuNull(contratante) || 'Vale';
  if (gestao !== undefined) dados.gestao = strOuNull(gestao);
  if (planejador !== undefined) dados.planejador = strOuNull(planejador);
  if (ativo !== undefined) dados.ativo = Boolean(ativo);

  const obra = await prisma.obra.update({ where: { id }, data: dados });
  res.json({ data: paraApi(obra) });
});

export const deletarObra = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const atual = await prisma.obra.findUnique({
    where: { id },
    include: { _count: { select: { partes_diarias: true } } },
  });
  if (!atual) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Obra nao encontrada.' });
  }
  // As partes diárias vinculadas mantêm o nome textual (obra_id vai a NULL).
  await prisma.obra.delete({ where: { id } });
  res.status(204).send();
});
