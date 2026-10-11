import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';

function calcularAderencia(obra, obra_programada) {
  if (!obra || !obra_programada) return null;
  return obra.trim().toUpperCase() === obra_programada.trim().toUpperCase();
}

export const listarPartesDiarias = asyncHandler(async (req, res) => {
  const { tag, data_inicio, data_fim, status_assinatura, status, page = 1, limit = 50 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where = {};
  if (tag) where.tag = tag;
  if (status) where.status = status;
  if (status_assinatura) where.status_assinatura = status_assinatura;
  if (data_inicio || data_fim) {
    where.data = {};
    if (data_inicio) where.data.gte = new Date(data_inicio);
    if (data_fim) where.data.lte = new Date(data_fim);
  }

  const [partes, total] = await Promise.all([
    prisma.parteDiaria.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { data: 'desc' },
      include: {
        veiculo: { select: { placa: true, modelo: true, status: true } },
      },
    }),
    prisma.parteDiaria.count({ where }),
  ]);

  res.json({
    data: partes,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

export const buscarParteDiaria = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parte = await prisma.parteDiaria.findUnique({
    where: { id },
    include: { veiculo: true },
  });

  if (!parte) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Parte diaria nao encontrada.' });
  }

  res.json({ data: parte });
});

export const criarParteDiaria = asyncHandler(async (req, res) => {
  const {
    tag,
    funcionario,
    funcao,
    obra,
    obra_programada,
    data,
    id_relatorio,
    status,
    lideranca,
    operador,
    eficiencia,
  } = req.body;

  if (!tag || !obra || !status) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'Os campos tag, obra e status sao obrigatorios.',
    });
  }

  const aderencia = calcularAderencia(obra, obra_programada);

  const parte = await prisma.parteDiaria.create({
    data: {
      tag,
      funcionario,
      funcao,
      obra,
      obra_programada,
      data: data ? new Date(data) : undefined,
      id_relatorio,
      status,
      lideranca,
      operador,
      aderencia,
      eficiencia: eficiencia !== undefined ? Number(eficiencia) : null,
    },
  });

  res.status(201).json({ data: parte });
});

export const atualizarParteDiaria = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    funcionario,
    funcao,
    obra,
    obra_programada,
    data,
    id_relatorio,
    status,
    lideranca,
    operador,
    eficiencia,
  } = req.body;

  const atual = await prisma.parteDiaria.findUnique({ where: { id } });
  if (!atual) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Parte diaria nao encontrada.' });
  }

  const novaObra = obra !== undefined ? obra : atual.obra;
  const novaObraProgramada = obra_programada !== undefined ? obra_programada : atual.obra_programada;
  const aderencia = calcularAderencia(novaObra, novaObraProgramada);

  const parte = await prisma.parteDiaria.update({
    where: { id },
    data: {
      funcionario,
      funcao,
      obra,
      obra_programada,
      data: data ? new Date(data) : undefined,
      id_relatorio,
      status,
      lideranca,
      operador,
      aderencia,
      eficiencia: eficiencia !== undefined ? Number(eficiencia) : undefined,
    },
  });

  res.json({ data: parte });
});

export const deletarParteDiaria = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.parteDiaria.delete({ where: { id } });
  res.status(204).send();
});

export const listarPendentesAssinatura = asyncHandler(async (req, res) => {
  const { tag, data_inicio, data_fim, page = 1, limit = 50 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where = {
    status_assinatura: 'PENDENTE',
  };
  if (tag) where.tag = tag;
  if (data_inicio || data_fim) {
    where.data = {};
    if (data_inicio) where.data.gte = new Date(data_inicio);
    if (data_fim) where.data.lte = new Date(data_fim);
  }

  const [partes, total] = await Promise.all([
    prisma.parteDiaria.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { data: 'asc' },
      include: {
        veiculo: { select: { tag: true, placa: true, modelo: true } },
      },
    }),
    prisma.parteDiaria.count({ where }),
  ]);

  res.json({
    data: partes,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

export const assinarParteDiaria = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { assinatura_base64, assinado_por, observacao } = req.body;

  if (!assinatura_base64 || !assinado_por) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'Os campos assinatura_base64 e assinado_por sao obrigatorios.',
    });
  }

  const atual = await prisma.parteDiaria.findUnique({ where: { id } });
  if (!atual) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Parte diaria nao encontrada.' });
  }

  if (atual.status_assinatura === 'ASSINADO') {
    return res.status(409).json({
      error: 'Conflito',
      message: 'Esta parte diaria ja foi assinada.',
    });
  }

  const assinatura_dados = {
    assinado_por,
    data_hora: new Date().toISOString(),
    assinatura_base64,
    observacao: observacao || null,
  };

  const parte = await prisma.parteDiaria.update({
    where: { id },
    data: {
      status_assinatura: 'ASSINADO',
      assinatura_dados,
    },
  });

  res.json({ data: parte });
});
