import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import config from '../config/index.js';

function calcularFarol(validade) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataValidade = new Date(validade);
  dataValidade.setHours(0, 0, 0, 0);

  const diffMs = dataValidade - hoje;
  const dias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  let status;
  if (dias < 0) status = 'VERMELHO';
  else if (dias < config.farol.diasAmarelo) status = 'AMARELO';
  else status = 'VERDE';

  return { farol_status: status, dias_para_vencer: dias };
}

export const listarDocumentacoes = asyncHandler(async (req, res) => {
  const { tag, farol, documento, page = 1, limit = 50 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where = {};
  if (tag) where.tag = tag;
  if (documento) where.documento = documento;

  const docs = await prisma.documentacaoVeiculo.findMany({
    where,
    skip,
    take: Number(limit),
    orderBy: { validade: 'asc' },
    include: {
      veiculo: { select: { placa: true, modelo: true, status: true } },
    },
  });

  const docsComFarol = docs.map((doc) => ({
    ...doc,
    ...calcularFarol(doc.validade),
  }));

  let filtrados = docsComFarol;
  if (farol) {
    filtrados = docsComFarol.filter((d) => d.farol_status === farol.toUpperCase());
  }

  const total = filtrados.length;

  res.json({
    data: filtrados,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
    },
  });
});

export const farolVencimentos = asyncHandler(async (req, res) => {
  const { tag } = req.query;

  const where = {};
  if (tag) where.tag = tag;

  const docs = await prisma.documentacaoVeiculo.findMany({
    where,
    orderBy: { validade: 'asc' },
    include: {
      veiculo: { select: { placa: true, modelo: true, status: true, tag: true } },
    },
  });

  const resultado = docs.map((doc) => {
    const farol = calcularFarol(doc.validade);
    return {
      id: doc.id,
      tag: doc.tag,
      placa: doc.veiculo?.placa,
      modelo: doc.veiculo?.modelo,
      documento: doc.documento,
      validade: doc.validade,
      anexo_url: doc.anexo_url,
      ...farol,
    };
  });

  const resumo = {
    VERDE: resultado.filter((r) => r.farol_status === 'VERDE').length,
    AMARELO: resultado.filter((r) => r.farol_status === 'AMARELO').length,
    VERMELHO: resultado.filter((r) => r.farol_status === 'VERMELHO').length,
    total: resultado.length,
  };

  res.json({
    resumo,
    data: resultado,
  });
});

export const buscarDocumentacao = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doc = await prisma.documentacaoVeiculo.findUnique({
    where: { id },
    include: { veiculo: true },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Documentacao nao encontrada.' });
  }

  res.json({ data: { ...doc, ...calcularFarol(doc.validade) } });
});

export const criarDocumentacao = asyncHandler(async (req, res) => {
  const { tag, documento, validade, anexo_url } = req.body;

  if (!tag || !documento || !validade) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'Os campos tag, documento e validade sao obrigatorios.',
    });
  }

  const doc = await prisma.documentacaoVeiculo.create({
    data: {
      tag,
      documento,
      validade: new Date(validade),
      anexo_url,
    },
  });

  res.status(201).json({ data: { ...doc, ...calcularFarol(doc.validade) } });
});

export const atualizarDocumentacao = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { documento, validade, anexo_url } = req.body;

  const doc = await prisma.documentacaoVeiculo.update({
    where: { id },
    data: {
      documento,
      validade: validade ? new Date(validade) : undefined,
      anexo_url,
    },
  });

  res.json({ data: { ...doc, ...calcularFarol(doc.validade) } });
});

export const deletarDocumentacao = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.documentacaoVeiculo.delete({ where: { id } });
  res.status(204).send();
});
