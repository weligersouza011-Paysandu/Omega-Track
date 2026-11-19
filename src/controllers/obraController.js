// ============================================================================
// src/controllers/obraController.js — Gestão de Obras
// Cadastro que alimenta o dropdown de Obra da Parte Diária (autofill de
// contrato, contratante, gestão/responsável e planejador).
// Leitura aberta; escrita restrita a Gestão/Transporte ou ADM Master.
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { contratoParaGravar, filtroContrato } from '../middleware/escopo.js';
import { lerPaginacao, blocoPaginacao } from '../utils/paginacao.js';

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
    planejadorMatricula: resto.planejador_matricula,
    contrato: resto.contrato,
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

// Planejador vinculado a obra: precisa ser usuario do mesmo contrato da obra.
// Guarda matricula + nome em texto, entao a obra sobrevive a exclusao do usuario.
async function resolverPlanejador(matricula, contrato) {
  const m = strOuNull(matricula);
  if (!m) return null;
  const usuario = await prisma.usuario.findUnique({ where: { matricula: m }, select: { matricula: true, nome: true, contrato: true } });
  if (!usuario || usuario.contrato !== contrato) {
    const erro = new Error('O planejador precisa ser um usuário do mesmo contrato da obra.');
    erro.statusCode = 400;
    erro.error = 'Planejador invalido';
    throw erro;
  }
  return usuario;
}

export const listarObras = asyncHandler(async (req, res) => {
  const { q, ativo } = req.query;
  const pag = lerPaginacao(req.query, { padrao: 100 });

  const where = { ...filtroContrato(req) };
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
      skip: pag.skip,
      take: pag.limit,
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      include: { _count: { select: { partes_diarias: true } } },
    }),
    prisma.obra.count({ where }),
  ]);

  res.json({
    data: obras.map(paraApi),
    pagination: blocoPaginacao(pag, total),
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
  const { nome, numeroContrato, contratante, gestao, planejador, planejadorMatricula, ativo, contrato } = req.body || {};

  if (!nome || !String(nome).trim()) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'O campo nome da obra e obrigatorio.',
    });
  }

  const contratoObra = contratoParaGravar(req, contrato);
  const planejadorVinculado = await resolverPlanejador(planejadorMatricula, contratoObra);

  const obra = await prisma.obra.create({
    data: {
      contrato: contratoObra,
      planejador_matricula: planejadorVinculado?.matricula ?? null,
      nome: String(nome).trim(),
      numero_contrato: strOuNull(numeroContrato),
      contratante: strOuNull(contratante) || 'Vale',
      gestao: strOuNull(gestao),
      planejador: strOuNull(planejador) ?? planejadorVinculado?.nome ?? null,
      ativo: ativo === undefined || ativo === null ? true : Boolean(ativo),
    },
  });

  res.status(201).json({ data: paraApi(obra) });
});

export const atualizarObra = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nome, numeroContrato, contratante, gestao, planejador, planejadorMatricula, ativo } = req.body || {};

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
  if (planejadorMatricula !== undefined) {
    const vinculado = await resolverPlanejador(planejadorMatricula, atual.contrato);
    dados.planejador_matricula = vinculado?.matricula ?? null;
    if (vinculado && planejador === undefined) dados.planejador = vinculado.nome;
  }
  if (ativo !== undefined) dados.ativo = Boolean(ativo);

  const obra = await prisma.obra.update({ where: { id }, data: dados });
  res.json({ data: paraApi(obra) });
});

export const deletarObra = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const atual = await prisma.obra.findUnique({
    where: { id },
    include: { _count: { select: { programacoes: true, programacoes_terceiros: true } } },
  });
  if (!atual) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Obra nao encontrada.' });
  }
  if (atual._count.programacoes > 0 || atual._count.programacoes_terceiros > 0) {
    return res.status(409).json({
      error: 'Obra programada',
      message: 'Esta obra possui equipamentos programados. Remova as programacoes antes de exclui-la.',
    });
  }
  // As partes diárias vinculadas mantêm o nome textual (obra_id vai a NULL).
  await prisma.obra.delete({ where: { id } });
  res.status(204).send();
});
