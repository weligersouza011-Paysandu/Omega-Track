import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import {
  parseKm,
  obterUltimaKmFinal,
  calcularStatusManutencao,
  resolverLimitePreventiva,
  resolverAncorasPreventiva,
  KM_LIMITE_PREVENTIVA_PADRAO,
} from '../services/manutencaoService.js';
import { uploadMiddleware, cloudinaryConfigured, validarUrlMidia, excluirAssetCloudinary } from '../config/cloudinary.js';

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

export const buscarStatusManutencao = asyncHandler(async (req, res) => {
  // GET /api/mob-desmob/:tag/status-manutencao?km_atual=&ignorar_parte_id=
  // Diagnóstico da preventiva. `km_atual` projeta a leitura (ex: KM Final
  // digitada no formulário); sem ele, usa a última KM Final registrada.
  const tagParam = String(req.params.tag || '').trim();
  let veiculo = await prisma.mobDesmob.findUnique({ where: { tag: tagParam } });
  if (!veiculo && tagParam) {
    veiculo = await prisma.mobDesmob.findUnique({ where: { tag: tagParam.toUpperCase() } });
  }
  if (!veiculo) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Veiculo nao encontrado.' });
  }
  const tag = veiculo.tag;
  const ignorarId = req.query.ignorar_parte_id || req.query.ignorar_id || null;
  const projetada = parseKm(req.query.km_atual);
  let kmAtual = projetada;
  let ultimaParte = null;
  if (kmAtual === null) {
    ultimaParte = await obterUltimaKmFinal(tag.toUpperCase(), ignorarId);
    kmAtual = ultimaParte.ultima_km_final;
  }
  // Limite dinâmico: parâmetros por categoria/contrato > veículo > padrão.
  const limiteResolvido = await resolverLimitePreventiva({
    limiteVeiculo: veiculo.km_limite_preventiva,
    categoria: veiculo.modelo,
    contrato: veiculo.contrato,
  });
  // Âncora do ciclo: última parte preventiva > coluna manual > 0.
  const ancora = await resolverAncorasPreventiva(tag.toUpperCase(), veiculo.km_ultima_preventiva);
  const diagnostico = calcularStatusManutencao({
    kmAtual,
    kmUltimaPreventiva: ancora.km_ultima_preventiva,
    kmLimite: limiteResolvido.km_limite,
  });
  res.json({
    data: {
      tag,
      km_atual: kmAtual,
      km_ultima_preventiva: ancora.km_ultima_preventiva,
      origem_preventiva: ancora.origem_preventiva,
      ultima_preventiva: ancora.parte_id
        ? { parte_id: ancora.parte_id, data: ancora.data, numero_relatorio: ancora.numero_relatorio }
        : null,
      sem_registro_preventiva: ancora.origem_preventiva === 'zero',
      km_projetada: projetada,
      ultima_parte: ultimaParte,
      origem_limite: limiteResolvido.origem_limite,
      parametro_id: limiteResolvido.parametro_id,
      ...diagnostico,
    },
  });
});

export const registrarPreventiva = asyncHandler(async (req, res) => {
  // POST /api/mob-desmob/:tag/preventiva { km? }
  // Registra a preventiva realizada (zera o acumulado). Sem `km`, usa a
  // última KM Final do veículo.
  const tagParam = String(req.params.tag || '').trim();
  let veiculo = await prisma.mobDesmob.findUnique({ where: { tag: tagParam } });
  if (!veiculo && tagParam) {
    veiculo = await prisma.mobDesmob.findUnique({ where: { tag: tagParam.toUpperCase() } });
  }
  if (!veiculo) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Veiculo nao encontrado.' });
  }
  let km = parseKm(req.body?.km);
  if (km === null) {
    const ultima = await obterUltimaKmFinal(veiculo.tag.toUpperCase());
    km = ultima.ultima_km_final;
  }
  if (km === null) {
    return res.status(400).json({
      error: 'Sem leitura',
      message: 'Informe a quilometragem da preventiva (`km`) — o veículo ainda não tem KM registrada.',
    });
  }
  const atualizado = await prisma.mobDesmob.update({
    where: { tag: veiculo.tag },
    data: { km_ultima_preventiva: Math.trunc(km) },
  });
  res.json({ data: atualizado });
});

function validarParametrosPreventiva({ km_limite_preventiva, km_ultima_preventiva }) {
  const dados = {};
  if (km_limite_preventiva !== undefined) {
    if (km_limite_preventiva === null || km_limite_preventiva === '') {
      dados.km_limite_preventiva = KM_LIMITE_PREVENTIVA_PADRAO;
    } else {
      const n = Number(km_limite_preventiva);
      if (!Number.isFinite(n) || n <= 0) {
        const err = new Error('`km_limite_preventiva` deve ser um número maior que zero.');
        err.statusCode = 400;
        throw err;
      }
      dados.km_limite_preventiva = Math.trunc(n);
    }
  }
  if (km_ultima_preventiva !== undefined) {
    if (km_ultima_preventiva === null || km_ultima_preventiva === '') {
      dados.km_ultima_preventiva = null;
    } else {
      const n = Number(km_ultima_preventiva);
      if (!Number.isFinite(n) || n < 0) {
        const err = new Error('`km_ultima_preventiva` deve ser um número maior ou igual a zero.');
        err.statusCode = 400;
        throw err;
      }
      dados.km_ultima_preventiva = Math.trunc(n);
    }
  }
  return dados;
}

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
      ...validarParametrosPreventiva(req.body),
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
      ...validarParametrosPreventiva(req.body),
    },
  });

  res.json({ data: veiculo });
});

export const deletarVeiculo = asyncHandler(async (req, res) => {
  const { tag } = req.params;
  await prisma.mobDesmob.delete({ where: { tag } });
  res.status(204).send();
});

// ============================================================================
// PUT /api/mob-desmob/:tag/desmobilizar — purga da documentacao na DESMOB.
// Regra de negocio: ao desmobilizar, os documentos e anexos do veiculo saem
// do controle de vencimentos, mas o registro do veiculo (historico, datas e
// status) e preservado. Partes diarias sao mantidas (historico operacional).
// Body JSON: { data_desmob?, responsavel?, observacao? }
// ============================================================================
function excluirAnexoCloudinary(url) {
  return excluirAssetCloudinary(url);
}

export const desmobilizarVeiculo = asyncHandler(async (req, res) => {
  const { tag } = req.params;
  const { data_desmob, responsavel, observacao } = req.body || {};

  const veiculo = await prisma.mobDesmob.findUnique({ where: { tag } });
  if (!veiculo) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Veiculo nao encontrado.' });
  }

  // 1. Anexos no Cloudinary: busca docs com URL e exclui (falha isolada nao trava).
  const docs = await prisma.documentacaoVeiculo.findMany({
    where: { tag },
    select: { id: true, anexo_url: true },
  });
  const comAnexo = docs.filter((d) => d.anexo_url);
  const resultados = await Promise.allSettled(comAnexo.map((d) => excluirAnexoCloudinary(d.anexo_url)));
  const anexosApagados = resultados.filter(
    (r) => r.status === 'fulfilled' && ['ok', 'deleted'].includes(r.value.status)
  ).length;

  // 2 + 3. Transacao: apaga docs do controle + registra a desmobilizacao.
  const [purga, atualizado] = await prisma.$transaction([
    prisma.documentacaoVeiculo.deleteMany({ where: { tag } }),
    prisma.mobDesmob.update({
      where: { tag },
      data: {
        status: 'Desmobilizado',
        data_desmob: data_desmob ? new Date(data_desmob) : new Date(),
        responsavel_desmob: responsavel ? String(responsavel).slice(0, 255) : null,
        observacao_desmob: observacao ? String(observacao) : null,
      },
    }),
  ]);

  res.json({
    data: {
      veiculo: atualizado,
      documentos_apagados: purga.count,
      anexos_encontrados: comAnexo.length,
      anexos_apagados: anexosApagados,
    },
  });
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
