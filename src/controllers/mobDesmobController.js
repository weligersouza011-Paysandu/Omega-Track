import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { uploadMiddleware, cloudinaryConfigured, validarUrlMidia } from '../config/cloudinary.js';

export const listarVeiculos = asyncHandler(async (req, res) => {
  const { status, contrato, page = 1, limit = 50 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where = {};
  if (status) where.status = status;
  if (contrato) where.contrato = contrato;

  const [veiculos, total] = await Promise.all([
    prisma.mobDesmob.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { created_at: 'desc' },
      include: {
        _count: {
          select: { documentacoes: true, partes_diarias: true },
        },
      },
    }),
    prisma.mobDesmob.count({ where }),
  ]);

  res.json({
    data: veiculos,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

export const buscarVeiculoPorTag = asyncHandler(async (req, res) => {
  const { tag } = req.params;
  const veiculo = await prisma.mobDesmob.findUnique({
    where: { tag },
    include: {
      documentacoes: { orderBy: { validade: 'asc' } },
      partes_diarias: { take: 10, orderBy: { data: 'desc' } },
    },
  });

  if (!veiculo) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Veiculo nao encontrado.' });
  }

  res.json({ data: veiculo });
});

export const buscarVeiculoPorPlaca = asyncHandler(async (req, res) => {
  const { placa } = req.params;
  const veiculo = await prisma.mobDesmob.findUnique({
    where: { placa: placa.toUpperCase() },
    include: {
      documentacoes: { orderBy: { validade: 'asc' } },
      partes_diarias: { take: 10, orderBy: { data: 'desc' } },
    },
  });

  if (!veiculo) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Veiculo nao encontrado para esta placa.' });
  }

  res.json({ data: veiculo });
});

export const criarVeiculo = asyncHandler(async (req, res) => {
  const { tag, placa, foto_veiculo, status, data_mob, data_desmob, modelo, contrato } = req.body;

  if (!tag || !placa || !status) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'Os campos tag, placa e status sao obrigatorios.',
    });
  }

  // Regra de ouro: foto_veiculo aceita SOMENTE URL do Cloudinary (sem binario).
  validarUrlMidia(foto_veiculo, 'foto_veiculo');

  const veiculo = await prisma.mobDesmob.create({
    data: {
      tag,
      placa: placa.toUpperCase(),
      foto_veiculo,
      status,
      data_mob: data_mob ? new Date(data_mob) : undefined,
      data_desmob: data_desmob ? new Date(data_desmob) : null,
      modelo,
      contrato,
    },
  });

  res.status(201).json({ data: veiculo });
});

export const atualizarVeiculo = asyncHandler(async (req, res) => {
  const { tag } = req.params;
  const { placa, foto_veiculo, status, data_mob, data_desmob, modelo, contrato } = req.body;

  // Regra de ouro: foto_veiculo aceita SOMENTE URL do Cloudinary (sem binario).
  validarUrlMidia(foto_veiculo, 'foto_veiculo');

  const veiculo = await prisma.mobDesmob.update({
    where: { tag },
    data: {
      placa: placa ? placa.toUpperCase() : undefined,
      foto_veiculo,
      status,
      data_mob: data_mob ? new Date(data_mob) : undefined,
      data_desmob: data_desmob ? new Date(data_desmob) : null,
      modelo,
      contrato,
    },
  });

  res.json({ data: veiculo });
});

export const deletarVeiculo = asyncHandler(async (req, res) => {
  const { tag } = req.params;
  await prisma.mobDesmob.delete({ where: { tag } });
  res.status(204).send();
});

// POST /api/mob-desmob/:tag/foto — campo `arquivo` (imagem).
// Sobe para omegatrack/mobilizacao e grava a secure_url em `foto_veiculo`.
export const atualizarFotoVeiculo = (req, res, next) => {
  if (!cloudinaryConfigured) {
    return res.status(503).json({
      error: 'Servico indisponivel',
      message: 'Upload de midia nao configurado (variaveis CLOUDINARY_* ausentes).',
    });
  }
  uploadMiddleware('mobilizacao')(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          err.message = 'Arquivo muito grande. Tamanho maximo: 5 MB.';
        }
        err.statusCode = err.statusCode || 400;
        throw err;
      }
      if (!req.file) {
        return res.status(400).json({
          error: 'Arquivo ausente',
          message: 'Envie a foto no campo `arquivo` (multipart/form-data).',
        });
      }
      const veiculo = await prisma.mobDesmob.update({
        where: { tag: req.params.tag },
        data: { foto_veiculo: req.file.path },
      });
      return res.json({
        data: { tag: veiculo.tag, foto_veiculo: veiculo.foto_veiculo, public_id: req.file.filename },
      });
    } catch (e) {
      return next(e);
    }
  });
};

export const vincularTelemetriaPorPlaca = asyncHandler(async (req, res) => {
  const { placa } = req.params;
  const telemetria = req.body;

  const veiculo = await prisma.mobDesmob.findUnique({
    where: { placa: placa.toUpperCase() },
    select: { tag: true, placa: true, status: true, modelo: true },
  });

  if (!veiculo) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Placa nao vinculada a nenhum veiculo.' });
  }

  res.json({
    data: {
      veiculo,
      telemetria_recebida: telemetria,
      timestamp: new Date().toISOString(),
    },
  });
});
