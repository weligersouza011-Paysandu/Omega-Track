import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { randomUUID } from 'node:crypto';
import { bloquearEquipamentos, tagsEmManutencao, erroEquipamentoEmManutencao } from './programacaoRecursosLocks.js';

const FILTRO_MOBILIZADOS = { status: 'Mobilizado', deletado_em: null };

// Veiculos terceiros vivem em tabela propria (veiculos_terceiros) e entram
// SOMENTE aqui, marcados com is_terceiro=true. A trava usa uma chave com
// prefixo para nunca colidir com as TAGs da frota propria.
const chaveTravaTerceiro = (id) => `terceiro:${id}`;

const SELECT_PROGRAMACAO_DIA = {
  id: true, obra_id: true, operador_matricula: true, operador_nome: true,
  operador_tarde_matricula: true, operador_tarde_nome: true,
  supervisor_matricula: true, supervisor_nome: true, updated_at: true,
};

// Campos de pessoas copiados entre dias (copiar ultima programacao).
const SELECT_PESSOAS_COPIA = {
  operador_matricula: true, operador_nome: true,
  operador_tarde_matricula: true, operador_tarde_nome: true,
  supervisor_matricula: true, supervisor_nome: true,
};

function camposProgramacao(programacao) {
  return {
    obraId: programacao?.obra_id ?? null,
    operadorMatricula: programacao?.operador_matricula ?? null,
    operadorNome: programacao?.operador_nome ?? null,
    operadorTardeMatricula: programacao?.operador_tarde_matricula ?? null,
    operadorTardeNome: programacao?.operador_tarde_nome ?? null,
    supervisorMatricula: programacao?.supervisor_matricula ?? null,
    supervisorNome: programacao?.supervisor_nome ?? null,
    atualizadoEm: programacao?.updated_at ?? null,
  };
}

// Ultimo dia (antes de `data`) com programacao da frota mobilizada ou de terceiros.
async function ultimaDataProgramada(client, data) {
  const frota = await client.programacaoRecurso.findFirst({
    where: { data: { lt: data }, equipamento: FILTRO_MOBILIZADOS },
    select: { data: true },
    orderBy: { data: 'desc' },
  });
  const terceiros = await client.programacaoRecursoTerceiro.findFirst({
    where: { data: { lt: data } },
    select: { data: true },
    orderBy: { data: 'desc' },
  });
  const datas = [frota?.data, terceiros?.data].filter(Boolean);
  return datas.length ? new Date(Math.max(...datas.map((item) => item.getTime()))) : null;
}

function dataValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const data = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== valor ? null : data;
}

function erroData(res) {
  return res.status(400).json({
    error: 'Data invalida',
    message: 'Informe uma data real no formato AAAA-MM-DD.',
  });
}

function formatarManutencao(registro) {
  if (!registro) return null;
  return {
    id: registro.id,
    tipo: registro.tipo,
    dataSaida: registro.data_saida.toISOString().slice(0, 10),
    previsaoRetorno: registro.previsao_retorno.toISOString().slice(0, 10),
    descricao: registro.descricao,
  };
}

// operador = motorista principal (manha); operadorTarde = 2o motorista
// (tarde) de onibus/vans, opcional e independente para os demais veiculos.
const CAMPOS_PESSOA = [
  ['operadorMatricula', 'operador'],
  ['operadorTardeMatricula', 'operador_tarde'],
  ['supervisorMatricula', 'supervisor'],
];

// O mesmo colaborador nao pode ser motorista da manha e da tarde no mesmo dia.
function motoristasRepetidos(item) {
  return Boolean(item?.operadorMatricula) && item.operadorMatricula === item.operadorTardeMatricula;
}

function erroMotoristasRepetidos(res) {
  return res.status(400).json({
    error: 'Dados invalidos',
    message: 'O motorista da tarde deve ser diferente do motorista da manhã.',
  });
}

function matriculaValida(valor) {
  return valor === null || (typeof valor === 'string' && valor.length > 0 &&
    valor.length <= 50 && valor === valor.trim());
}

function dadosPessoas(item, pessoasPorMatricula) {
  const dados = {};
  for (const [campo, prefixo] of CAMPOS_PESSOA) {
    if (item[campo] === undefined) continue;
    const pessoa = item[campo] === null ? null : pessoasPorMatricula.get(item[campo]);
    dados[`${prefixo}_matricula`] = pessoa?.matricula ?? null;
    dados[`${prefixo}_nome`] = pessoa?.nome ?? null;
  }
  return dados;
}

async function buscarPessoas(matriculas) {
  if (!matriculas.size) return new Map();
  const pessoas = await prisma.usuario.findMany({
    where: { matricula: { in: [...matriculas] } },
    select: { matricula: true, nome: true },
  });
  return new Map(pessoas.map((pessoa) => [pessoa.matricula, pessoa]));
}

export const listarProgramacao = asyncHandler(async (req, res) => {
  const data = dataValida(req.query.data);
  if (!data) return erroData(res);

  const [equipamentos, terceiros, obras, pessoas, ultimaData] = await Promise.all([
    prisma.mobDesmob.findMany({
      where: FILTRO_MOBILIZADOS,
      select: {
        tag: true,
        placa: true,
        modelo: true,
        contrato: true,
        status: true,
        foto_veiculo: true,
        programacoes: {
          where: { data },
          select: SELECT_PROGRAMACAO_DIA,
        },
        manutencoes: {
          where: { OR: [
            { data_retorno: null },
            { data_saida: { lte: data }, data_retorno: { gt: data } },
          ] },
          select: { id: true, tipo: true, data_saida: true, previsao_retorno: true, data_retorno: true, descricao: true },
          orderBy: { data_saida: 'desc' },
        },
      },
      orderBy: [{ modelo: 'asc' }, { tag: 'asc' }],
    }),
    prisma.veiculoTerceiro.findMany({
      select: {
        id: true, tag: true, tipo: true, empresa_terceira: true, placa: true, modelo: true, foto_url: true,
        programacoes: { where: { data }, select: SELECT_PROGRAMACAO_DIA },
      },
      orderBy: [{ tipo: 'asc' }, { tag: 'asc' }],
    }),
    prisma.obra.findMany({
      select: { id: true, nome: true, numero_contrato: true, ativo: true },
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    }),
    prisma.usuario.findMany({
      select: { matricula: true, nome: true, funcao: true, tipo: true },
      orderBy: { nome: 'asc' },
    }),
    ultimaDataProgramada(prisma, data),
  ]);
  const totalUltima = ultimaData ? (await Promise.all([
    prisma.programacaoRecurso.count({ where: { data: ultimaData, equipamento: FILTRO_MOBILIZADOS } }),
    prisma.programacaoRecursoTerceiro.count({ where: { data: ultimaData } }),
  ])).reduce((total, parcial) => total + parcial, 0) : 0;

  res.json({
    data: {
      data: req.query.data,
      ultimaProgramacao: ultimaData
        ? { data: ultimaData.toISOString().slice(0, 10), totalProgramados: totalUltima }
        : null,
      // Lista unificada: [...frotaAtiva, ...veiculosTerceiros]. Terceiros usam o
      // `tipo` como `modelo` para agrupar com os mesmos tipos da frota.
      equipamentos: [
        ...equipamentos.map(({ programacoes, manutencoes, foto_veiculo: fotoUrl, ...equipamento }) => ({
          ...equipamento,
          is_terceiro: false,
          fotoUrl,
          manutencaoAtiva: formatarManutencao(manutencoes.find((item) => !item.data_retorno)),
          manutencaoNoDia: formatarManutencao(manutencoes.find((item) =>
            item.data_saida <= data && (!item.data_retorno || item.data_retorno > data))),
          ...camposProgramacao(programacoes[0]),
        })),
        ...terceiros.map(({ programacoes, ...terceiro }) => ({
          tag: terceiro.tag,
          placa: terceiro.placa,
          modelo: terceiro.tipo,
          contrato: terceiro.empresa_terceira,
          status: 'Terceiro',
          is_terceiro: true,
          terceiroId: terceiro.id,
          empresaTerceira: terceiro.empresa_terceira,
          modeloVeiculo: terceiro.modelo,
          fotoUrl: terceiro.foto_url,
          manutencaoAtiva: null,
          manutencaoNoDia: null,
          ...camposProgramacao(programacoes[0]),
        })),
      ],
      pessoas,
      obras: obras.map((obra) => ({
        id: obra.id,
        nome: obra.nome,
        numeroContrato: obra.numero_contrato,
        ativo: obra.ativo,
      })),
    },
  });
});

export const copiarUltimaProgramacao = asyncHandler(async (req, res) => {
  const data = dataValida(req.body?.data);
  if (!data) return erroData(res);

  const resultado = await prisma.$transaction(async (tx) => {
    // A copia altera somente equipamentos mobilizados e preserva o historico dos demais.
    // Trava todos os mobilizados antes de ler a origem para manter a operacao consistente.
    const frota = await tx.mobDesmob.findMany({ where: FILTRO_MOBILIZADOS, select: { tag: true } });
    const terceiros = await tx.veiculoTerceiro.findMany({ select: { id: true } });
    await bloquearEquipamentos(tx, [
      ...frota.map((item) => item.tag),
      ...terceiros.map((item) => chaveTravaTerceiro(item.id)),
    ]);
    const ultimaData = await ultimaDataProgramada(tx, data);
    if (!ultimaData) {
      return { status: 409, message: 'Não há programação anterior a esta data para copiar.' };
    }
    const ultima = { data: ultimaData };
    const dataOrigem = ultima.data.toISOString().slice(0, 10);
    if (req.body?.origemEsperada && req.body.origemEsperada !== dataOrigem) {
      return { status: 409, message: 'A programação de origem mudou. Atualize a página antes de copiar.' };
    }
    const origem = await tx.programacaoRecurso.findMany({
      where: { data: ultima.data, equipamento: FILTRO_MOBILIZADOS },
      select: {
        tag: true, obra_id: true, ...SELECT_PESSOAS_COPIA, obra: { select: { ativo: true } },
      },
    });
    const origemTerceiros = await tx.programacaoRecursoTerceiro.findMany({
      where: { data: ultima.data },
      select: {
        veiculo_terceiro_id: true, obra_id: true, ...SELECT_PESSOAS_COPIA, obra: { select: { ativo: true } },
      },
    });
    if (origem.length === 0 && origemTerceiros.length === 0) {
      return { status: 409, message: 'A programação de origem mudou. Atualize a página antes de copiar.' };
    }
    const bloqueadas = await tagsEmManutencao(tx, frota.map((item) => item.tag));
    const bloqueadasSet = new Set(bloqueadas);
    const origemDisponivel = origem.filter((item) => !bloqueadasSet.has(item.tag));
    if (!origemDisponivel.length && !origemTerceiros.length) {
      return { status: 409, message: 'Todos os equipamentos da ultima programacao estao em manutencao.' };
    }
    if ([...origemDisponivel, ...origemTerceiros].some((item) => !item.obra.ativo)) {
      return { status: 409, message: 'A última programação contém obra inativa. Ative essa obra antes de copiar.' };
    }

    const filtroDestino = { data, equipamento: FILTRO_MOBILIZADOS, tag: { notIn: bloqueadas } };
    const substituidos = await tx.programacaoRecurso.count({ where: filtroDestino });
    await tx.programacaoRecurso.deleteMany({ where: filtroDestino });
    await tx.programacaoRecurso.createMany({
      data: origemDisponivel.map((item) => ({
        id: randomUUID(),
        tag: item.tag,
        obra_id: item.obra_id,
        operador_matricula: item.operador_matricula,
        operador_nome: item.operador_nome,
        operador_tarde_matricula: item.operador_tarde_matricula,
        operador_tarde_nome: item.operador_tarde_nome,
        supervisor_matricula: item.supervisor_matricula,
        supervisor_nome: item.supervisor_nome,
        data,
      })),
    });
    const substituidosTerceiros = await tx.programacaoRecursoTerceiro.count({ where: { data } });
    await tx.programacaoRecursoTerceiro.deleteMany({ where: { data } });
    if (origemTerceiros.length) {
      await tx.programacaoRecursoTerceiro.createMany({
        data: origemTerceiros.map(({ obra, ...item }) => ({ id: randomUUID(), ...item, data })),
      });
    }
    return {
      origem: dataOrigem,
      copiados: origemDisponivel.length + origemTerceiros.length,
      substituidos: substituidos + substituidosTerceiros,
      ignoradosManutencao: origem.length - origemDisponivel.length,
    };
  });

  if (resultado.status) {
    return res.status(resultado.status).json({ error: 'Copia indisponivel', message: resultado.message });
  }
  res.json({
    data: {
      destino: req.body.data,
      ...resultado,
    },
  });
});

export const salvarProgramacaoEmLote = asyncHandler(async (req, res) => {
  const data = dataValida(req.body?.data);
  if (!data) return erroData(res);

  const alteracoes = req.body?.alteracoes;
  if (!Array.isArray(alteracoes) || alteracoes.length === 0 || alteracoes.length > 500) {
    return res.status(400).json({
      error: 'Dados invalidos',
      message: 'Informe entre 1 e 500 alterações de equipamentos.',
    });
  }

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tags = new Set();
  const obrasIds = new Set();
  const matriculas = new Set();
  for (const item of alteracoes) {
    if (!item || typeof item.tag !== 'string' || !item.tag.trim() || item.tag.length > 50 ||
        tags.has(item.tag) || (item.obraId !== null && (typeof item.obraId !== 'string' || !uuid.test(item.obraId))) ||
        CAMPOS_PESSOA.some(([campo]) => item[campo] !== undefined && !matriculaValida(item[campo]))) {
      return res.status(400).json({
        error: 'Dados invalidos',
        message: 'Cada alteração deve ter uma TAG única, uma obra válida ou null, e matrículas válidas.',
      });
    }
    if (motoristasRepetidos(item)) return erroMotoristasRepetidos(res);
    tags.add(item.tag);
    if (item.obraId) obrasIds.add(item.obraId);
    if (item.obraId) {
      for (const [campo] of CAMPOS_PESSOA) if (item[campo]) matriculas.add(item[campo]);
    }
  }

  const [equipamentos, terceiros, obras, pessoasPorMatricula] = await Promise.all([
    prisma.mobDesmob.findMany({
      where: { tag: { in: [...tags] }, ...FILTRO_MOBILIZADOS },
      select: { tag: true },
    }),
    prisma.veiculoTerceiro.findMany({
      where: { tag: { in: [...tags] } },
      select: { id: true, tag: true },
    }),
    prisma.obra.findMany({
      where: { id: { in: [...obrasIds] }, ativo: true },
      select: { id: true },
    }),
    buscarPessoas(matriculas),
  ]);
  const tagsFrota = equipamentos.map((item) => item.tag);
  const terceiroPorTag = new Map(terceiros.map((item) => [item.tag, item.id]));
  if (equipamentos.length + terceiros.length !== tags.size) {
    return res.status(404).json({
      error: 'Equipamento nao encontrado',
      message: 'Um ou mais equipamentos não estão mobilizados ou disponíveis na frota.',
    });
  }
  if (obras.length !== obrasIds.size) {
    return res.status(400).json({
      error: 'Obra invalida',
      message: 'Uma ou mais obras não existem ou estão inativas. Atualize a página.',
    });
  }
  if (pessoasPorMatricula.size !== matriculas.size) {
    return res.status(400).json({
      error: 'Usuario invalido',
      message: 'Um ou mais operadores, motoristas ou supervisores não estão cadastrados. Atualize a página.',
    });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    await bloquearEquipamentos(tx, [...tagsFrota, ...[...terceiroPorTag.values()].map(chaveTravaTerceiro)]);
    const mobilizados = await tx.mobDesmob.count({
      where: { tag: { in: tagsFrota }, ...FILTRO_MOBILIZADOS },
    });
    const terceirosVigentes = await tx.veiculoTerceiro.count({
      where: { id: { in: [...terceiroPorTag.values()] } },
    });
    if (mobilizados !== tagsFrota.length || terceirosVigentes !== terceiroPorTag.size) return { indisponiveis: true };
    const bloqueadas = await tagsEmManutencao(tx, tagsFrota);
    if (bloqueadas.length) return { bloqueadas };
    const remover = alteracoes.filter((item) => item.obraId === null && !terceiroPorTag.has(item.tag))
      .map((item) => item.tag);
    if (remover.length) {
      await tx.programacaoRecurso.deleteMany({ where: { data, tag: { in: remover } } });
    }
    const removerTerceiros = alteracoes.filter((item) => item.obraId === null && terceiroPorTag.has(item.tag))
      .map((item) => terceiroPorTag.get(item.tag));
    if (removerTerceiros.length) {
      await tx.programacaoRecursoTerceiro.deleteMany({
        where: { data, veiculo_terceiro_id: { in: removerTerceiros } },
      });
    }
    for (const item of alteracoes) {
      if (item.obraId === null) continue;
      const terceiroId = terceiroPorTag.get(item.tag);
      if (terceiroId) {
        await tx.programacaoRecursoTerceiro.upsert({
          where: { veiculo_terceiro_id_data: { veiculo_terceiro_id: terceiroId, data } },
          create: { veiculo_terceiro_id: terceiroId, data, obra_id: item.obraId, ...dadosPessoas(item, pessoasPorMatricula) },
          update: { obra_id: item.obraId, ...dadosPessoas(item, pessoasPorMatricula) },
        });
        continue;
      }
      await tx.programacaoRecurso.upsert({
        where: { tag_data: { tag: item.tag, data } },
        create: { tag: item.tag, data, obra_id: item.obraId, ...dadosPessoas(item, pessoasPorMatricula) },
        update: { obra_id: item.obraId, ...dadosPessoas(item, pessoasPorMatricula) },
      });
    }
    return { bloqueadas: [] };
  });

  if (resultado.indisponiveis) {
    return res.status(404).json({ error: 'Equipamento nao encontrado', message: 'Um ou mais equipamentos não estão mobilizados ou disponíveis na frota.' });
  }
  if (resultado.bloqueadas.length) return erroEquipamentoEmManutencao(res, resultado.bloqueadas);

  res.json({ data: { data: req.body.data, salvas: alteracoes.length } });
});

export const salvarProgramacao = asyncHandler(async (req, res) => {
  const data = dataValida(req.params.data);
  if (!data) return erroData(res);

  const tag = String(req.params.tag || '').trim();
  const obraId = req.body?.obraId;
  if (!tag || typeof obraId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obraId)) {
    return res.status(400).json({ error: 'Dados invalidos', message: 'Informe uma TAG e uma obra valida.' });
  }

  if (CAMPOS_PESSOA.some(([campo]) => req.body?.[campo] !== undefined && !matriculaValida(req.body[campo]))) {
    return res.status(400).json({ error: 'Dados invalidos', message: 'Informe matrículas válidas.' });
  }
  if (motoristasRepetidos(req.body)) return erroMotoristasRepetidos(res);
  const matriculas = new Set(CAMPOS_PESSOA.map(([campo]) => req.body?.[campo]).filter(Boolean));
  const [equipamento, obra, pessoasPorMatricula] = await Promise.all([
    prisma.mobDesmob.findUnique({ where: { tag }, select: { tag: true, status: true, deletado_em: true } }),
    prisma.obra.findUnique({ where: { id: obraId }, select: { id: true, ativo: true } }),
    buscarPessoas(matriculas),
  ]);
  if (!equipamento || equipamento.deletado_em || equipamento.status !== 'Mobilizado') {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Equipamento nao mobilizado ou indisponivel na frota.' });
  }
  if (!obra) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Obra nao encontrada.' });
  }
  if (!obra.ativo) {
    return res.status(400).json({ error: 'Obra inativa', message: 'Ative a obra antes de programar equipamentos nela.' });
  }
  if (pessoasPorMatricula.size !== matriculas.size) {
    return res.status(400).json({ error: 'Usuario invalido', message: 'Operador, motorista ou supervisor não cadastrado.' });
  }

  const pessoas = dadosPessoas(req.body, pessoasPorMatricula);
  const resultado = await prisma.$transaction(async (tx) => {
    await bloquearEquipamentos(tx, [tag]);
    const equipamento = await tx.mobDesmob.findUnique({
      where: { tag }, select: { status: true, deletado_em: true },
    });
    if (!equipamento || equipamento.deletado_em || equipamento.status !== 'Mobilizado') {
      return { indisponivel: true };
    }
    if ((await tagsEmManutencao(tx, [tag])).length) return { bloqueadas: [tag] };
    const programacao = await tx.programacaoRecurso.upsert({
      where: { tag_data: { tag, data } },
      create: { tag, data, obra_id: obraId, ...pessoas },
      update: { obra_id: obraId, ...pessoas },
      select: { tag: true, data: true, ...SELECT_PROGRAMACAO_DIA },
    });
    return { programacao };
  });
  if (resultado.indisponivel) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Equipamento nao mobilizado ou indisponivel na frota.' });
  }
  if (resultado.bloqueadas) return erroEquipamentoEmManutencao(res, resultado.bloqueadas);
  const { programacao } = resultado;

  res.json({
    data: {
      id: programacao.id,
      tag: programacao.tag,
      ...camposProgramacao(programacao),
      data: programacao.data.toISOString().slice(0, 10),
    },
  });
});

export const removerProgramacao = asyncHandler(async (req, res) => {
  const data = dataValida(req.params.data);
  if (!data) return erroData(res);

  const tag = String(req.params.tag || '').trim();
  if (!tag) {
    return res.status(400).json({ error: 'TAG invalida', message: 'Informe a TAG do equipamento.' });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    await bloquearEquipamentos(tx, [tag]);
    const equipamento = await tx.mobDesmob.findUnique({
      where: { tag }, select: { status: true, deletado_em: true },
    });
    if (!equipamento || equipamento.deletado_em || equipamento.status !== 'Mobilizado') {
      return { indisponivel: true };
    }
    if ((await tagsEmManutencao(tx, [tag])).length) return { bloqueadas: [tag] };
    await tx.programacaoRecurso.deleteMany({ where: { tag, data } });
    return {};
  });
  if (resultado.indisponivel) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Equipamento nao mobilizado ou indisponivel na frota.' });
  }
  if (resultado.bloqueadas) return erroEquipamentoEmManutencao(res, resultado.bloqueadas);
  res.status(204).send();
});
