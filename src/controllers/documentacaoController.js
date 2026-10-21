import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import config from '../config/index.js';
import { uploadMiddleware, cloudinaryConfigured, validarUrlMidia, excluirAssetCloudinary } from '../config/cloudinary.js';

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
  // Controle de vencimentos considera SOMENTE veiculos mobilizados e ativos.
  where.veiculo = { status: 'Mobilizado', deletado_em: null };

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
  // Farol considera SOMENTE veiculos mobilizados e ativos.
  where.veiculo = { status: 'Mobilizado', deletado_em: null };

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

  if (!doc || doc.veiculo?.deletado_em) {
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

  // Regra de ouro: anexo_url aceita SOMENTE URL do Cloudinary (sem binario).
  validarUrlMidia(anexo_url, 'anexo_url');

  const veiculoAtivo = await prisma.mobDesmob.findFirst({ where: { tag, deletado_em: null } });
  if (!veiculoAtivo) {
    return res.status(400).json({ error: 'Veiculo invalido', message: 'TAG nao encontrada na frota ativa.' });
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

  // Regra de ouro: anexo_url aceita SOMENTE URL do Cloudinary (sem binario).
  validarUrlMidia(anexo_url, 'anexo_url');

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

// POST /api/documentacao-veiculos/:id/anexo — campo `arquivo` (imagem).
// Sobe para omegatrack/documentos e grava a secure_url em `anexo_url`.
export const anexarArquivo = (req, res, next) => {
  if (!cloudinaryConfigured) {
    return res.status(503).json({
      error: 'Servico indisponivel',
      message: 'Upload de midia nao configurado (variaveis CLOUDINARY_* ausentes).',
    });
  }
  uploadMiddleware('documentos')(req, res, async (err) => {
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
          message: 'Envie o anexo no campo `arquivo` (multipart/form-data).',
        });
      }
      const doc = await prisma.documentacaoVeiculo.update({
        where: { id: req.params.id },
        data: { anexo_url: req.file.path },
      });
      return res.json({
        data: { id: doc.id, anexo_url: doc.anexo_url, public_id: req.file.filename },
      });
    } catch (e) {
      return next(e);
    }
  });
};

// ============================================================================
// Expurgo retroativo: remove do controle todo documento vinculado a veiculo
// DESMOBILIZADO (anexos no Cloudinary + registros), preservando o historico
// do veiculo. Executado no boot do servidor; nunca derruba a inicializacao.
// ============================================================================
export async function expurgarDocumentosDesmobilizados() {
  const pendentes = await prisma.documentacaoVeiculo.findMany({
    where: { veiculo: { status: 'Desmobilizado' } },
    select: { id: true, tag: true, anexo_url: true },
  });
  if (pendentes.length === 0) {
    console.log('[BOOT-PURGA] nenhum documento de desmobilizado pendente.');
    return { documentos: 0, anexos: 0 };
  }
  const tags = [...new Set(pendentes.map((d) => d.tag))];
  const comAnexo = pendentes.filter((d) => d.anexo_url);
  const resultados = await Promise.allSettled(comAnexo.map((d) => excluirAssetCloudinary(d.anexo_url)));
  const anexos = resultados.filter(
    (r) => r.status === 'fulfilled' && ['ok', 'deleted'].includes(r.value.status)
  ).length;
  const del = await prisma.documentacaoVeiculo.deleteMany({
    where: { id: { in: pendentes.map((d) => d.id) } },
  });
  console.log(
    `[BOOT-PURGA] ${del.count} documento(s) de veiculos desmobilizados expurgados ` +
    `(tags: ${tags.join(', ')}; anexos removidos: ${anexos}/${comAnexo.length}).`
  );
  return { documentos: del.count, anexos };
}
