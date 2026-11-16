// ============================================================================
// Categorias de desvio da Programacao (motivos para a Parte Diaria fugir da
// obra programada). Parametrizaveis pelo admin. Categoria ja usada em algum
// RDO nunca e apagada: e desativada, preservando o historico do indicador.
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { registrarLogAtividade } from '../services/auditService.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nomeValido(valor) {
  const nome = String(valor ?? '').trim().replace(/\s+/g, ' ');
  return nome && nome.length <= 120 ? nome : null;
}

async function nomeEmUso(nome, idAtual = null) {
  const existente = await prisma.categoriaDesvioProgramacao.findFirst({
    where: { nome: { equals: nome, mode: 'insensitive' }, ...(idAtual ? { NOT: { id: idAtual } } : {}) },
    select: { id: true },
  });
  return Boolean(existente);
}

// GET /api/categorias-desvio?ativas=1  (o RDO pede só as ativas)
export const listarCategoriasDesvio = asyncHandler(async (req, res) => {
  const somenteAtivas = ['1', 'true'].includes(String(req.query.ativas || '').toLowerCase());
  const categorias = await prisma.categoriaDesvioProgramacao.findMany({
    where: somenteAtivas ? { ativo: true } : {},
    orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    select: { id: true, nome: true, ativo: true, created_at: true, _count: { select: { partes_diarias: true } } },
  });
  res.json({
    data: categorias.map(({ _count, ...c }) => ({ ...c, total_usos: _count.partes_diarias })),
  });
});

export const criarCategoriaDesvio = asyncHandler(async (req, res) => {
  const nome = nomeValido(req.body?.nome);
  if (!nome) return res.status(400).json({ error: 'Dados invalidos', message: 'Informe o nome da categoria (até 120 caracteres).' });
  if (await nomeEmUso(nome)) return res.status(409).json({ error: 'Categoria existente', message: `Já existe a categoria "${nome}".` });
  const categoria = await prisma.categoriaDesvioProgramacao.create({
    data: { nome, ativo: req.body?.ativo !== false },
  });
  await registrarLogAtividade(req, { acao: 'CRIAR_CATEGORIA_DESVIO', modulo: 'Programacao', detalhes: { id: categoria.id, nome } });
  res.status(201).json({ data: categoria });
});

// PUT /:id { nome?, ativo? } — renomear ou ativar/desativar.
export const atualizarCategoriaDesvio = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'ID invalido', message: 'Identificador inválido.' });
  const atual = await prisma.categoriaDesvioProgramacao.findUnique({ where: { id } });
  if (!atual) return res.status(404).json({ error: 'Nao encontrado', message: 'Categoria não encontrada.' });

  const dados = {};
  if (req.body?.nome !== undefined) {
    const nome = nomeValido(req.body.nome);
    if (!nome) return res.status(400).json({ error: 'Dados invalidos', message: 'Informe o nome da categoria (até 120 caracteres).' });
    if (await nomeEmUso(nome, id)) return res.status(409).json({ error: 'Categoria existente', message: `Já existe a categoria "${nome}".` });
    dados.nome = nome;
  }
  if (req.body?.ativo !== undefined) {
    if (typeof req.body.ativo !== 'boolean') return res.status(400).json({ error: 'Dados invalidos', message: '`ativo` deve ser true ou false.' });
    dados.ativo = req.body.ativo;
  }
  const categoria = await prisma.categoriaDesvioProgramacao.update({ where: { id }, data: dados });
  await registrarLogAtividade(req, { acao: 'ATUALIZAR_CATEGORIA_DESVIO', modulo: 'Programacao', detalhes: { id, ...dados } });
  res.json({ data: categoria });
});

// DELETE /:id — sem uso: apaga; em uso: só desativa (histórico preservado).
export const excluirCategoriaDesvio = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'ID invalido', message: 'Identificador inválido.' });
  const atual = await prisma.categoriaDesvioProgramacao.findUnique({
    where: { id }, select: { id: true, nome: true, _count: { select: { partes_diarias: true } } },
  });
  if (!atual) return res.status(404).json({ error: 'Nao encontrado', message: 'Categoria não encontrada.' });

  if (atual._count.partes_diarias > 0) {
    const categoria = await prisma.categoriaDesvioProgramacao.update({ where: { id }, data: { ativo: false } });
    await registrarLogAtividade(req, { acao: 'DESATIVAR_CATEGORIA_DESVIO', modulo: 'Programacao', detalhes: { id, nome: atual.nome } });
    return res.json({
      data: { ...categoria, desativada: true },
      message: `"${atual.nome}" está em ${atual._count.partes_diarias} parte(s) diária(s); foi desativada em vez de excluída.`,
    });
  }
  await prisma.categoriaDesvioProgramacao.delete({ where: { id } });
  await registrarLogAtividade(req, { acao: 'EXCLUIR_CATEGORIA_DESVIO', modulo: 'Programacao', detalhes: { id, nome: atual.nome } });
  res.status(204).send();
});
