import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { bloquearEquipamentos } from './programacaoRecursosLocks.js';

function dataValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const data = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== valor ? null : data;
}

function hojeBrasil() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function respostaManutencao(registro) {
  return {
    id: registro.id,
    tag: registro.tag,
    tipo: registro.tipo,
    dataSaida: registro.data_saida.toISOString().slice(0, 10),
    previsaoRetorno: registro.previsao_retorno.toISOString().slice(0, 10),
    descricao: registro.descricao,
    dataRetorno: registro.data_retorno?.toISOString().slice(0, 10) ?? null,
    registradoPor: registro.registrado_por,
    retornadoPor: registro.retornado_por,
  };
}

export const iniciarManutencao = asyncHandler(async (req, res) => {
  const tag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
  const tipo = req.body?.tipo;
  const dataSaida = dataValida(req.body?.dataSaida);
  const previsaoRetorno = dataValida(req.body?.previsaoRetorno);
  const descricao = typeof req.body?.descricao === 'string' ? req.body.descricao.trim() : '';

  if (!tag || tag.length > 50 || !['PREVENTIVA', 'CORRETIVA'].includes(tipo) ||
      !dataSaida || !previsaoRetorno || !descricao || descricao.length > 2000) {
    return res.status(400).json({
      error: 'Dados invalidos',
      message: 'Informe equipamento, tipo, datas validas e uma descricao de ate 2000 caracteres.',
    });
  }
  if (previsaoRetorno < dataSaida || req.body.dataSaida > hojeBrasil()) {
    return res.status(400).json({
      error: 'Datas invalidas',
      message: 'A saida nao pode ser futura e a previsao deve ser igual ou posterior a saida.',
    });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    await bloquearEquipamentos(tx, [tag]);
    const equipamento = await tx.mobDesmob.findUnique({
      where: { tag }, select: { tag: true, deletado_em: true },
    });
    if (!equipamento || equipamento.deletado_em) return { status: 404, message: 'Equipamento nao encontrado na frota ativa.' };
    const aberta = await tx.manutencaoRecurso.findFirst({ where: { tag, data_retorno: null } });
    if (aberta) return { status: 409, message: 'Este equipamento ja possui uma manutencao em aberto.' };

    const registro = await tx.manutencaoRecurso.create({
      data: {
        tag, tipo, data_saida: dataSaida, previsao_retorno: previsaoRetorno,
        descricao, registrado_por: req.atuante.matricula,
      },
    });
    return { registro };
  });

  if (resultado.status) return res.status(resultado.status).json({ error: 'Manutencao indisponivel', message: resultado.message });
  res.status(201).json({ data: respostaManutencao(resultado.registro) });
});

export const registrarRetornoManutencao = asyncHandler(async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id || '')) {
    return res.status(400).json({ error: 'Dados invalidos', message: 'Informe uma manutencao valida.' });
  }
  const dataRetorno = dataValida(req.body?.dataRetorno);
  if (!dataRetorno || req.body.dataRetorno > hojeBrasil()) {
    return res.status(400).json({
      error: 'Data invalida', message: 'Informe uma data de retorno real que nao seja futura.',
    });
  }
  const atual = await prisma.manutencaoRecurso.findUnique({
    where: { id: req.params.id }, select: { tag: true },
  });
  if (!atual) return res.status(404).json({ error: 'Nao encontrado', message: 'Manutencao nao encontrada.' });

  const resultado = await prisma.$transaction(async (tx) => {
    await bloquearEquipamentos(tx, [atual.tag]);
    const registro = await tx.manutencaoRecurso.findUnique({ where: { id: req.params.id } });
    if (!registro) return { status: 404, message: 'Manutencao nao encontrada.' };
    if (registro.data_retorno) return { status: 409, message: 'O retorno desta manutencao ja foi registrado.' };
    if (dataRetorno < registro.data_saida) {
      return { status: 400, message: 'O retorno nao pode ocorrer antes da saida para manutencao.' };
    }
    const salvo = await tx.manutencaoRecurso.update({
      where: { id: registro.id },
      data: { data_retorno: dataRetorno, retornado_por: req.atuante.matricula },
    });
    return { registro: salvo };
  });

  if (resultado.status) return res.status(resultado.status).json({ error: 'Retorno indisponivel', message: resultado.message });
  res.json({ data: respostaManutencao(resultado.registro) });
});
