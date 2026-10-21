import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';

const STATUS_CONFORME = 'CONFORME';
const STATUS_ALERTA = 'ALERTA';
const STATUS_VENCIDO = 'VENCIDO';
const STATUS_PENDENTE = 'PENDENTE';
const DIAS_ALERTA = 30;
const MESES_VALIDADE = 6;
const TAMANHO_MAX_OBSERVACAO = 2000;

function hojeISOOperacao() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const valor = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return `${valor.year}-${valor.month}-${valor.day}`;
}

function isoDeData(valor) {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return data.toISOString().slice(0, 10);
}

function dataUTC(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function diferencaEmDias(alvoISO, baseISO) {
  const alvo = dataUTC(alvoISO);
  const base = dataUTC(baseISO);
  return Math.round((alvo - base) / (24 * 60 * 60 * 1000));
}

function validarDataISO(valor) {
  const texto = String(valor ?? '').trim();
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) return null;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    data.getUTCFullYear() !== ano
    || data.getUTCMonth() !== mes - 1
    || data.getUTCDate() !== dia
  ) {
    return null;
  }
  const iso = `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  return { iso, data };
}

function adicionarMesesISO(iso, meses) {
  const [anoBase, mesBase, diaBase] = iso.split('-').map(Number);
  const indiceMes = (mesBase - 1) + meses;
  const ano = anoBase + Math.floor(indiceMes / 12);
  const mes = ((indiceMes % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dia = Math.min(diaBase, ultimoDia);
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function classificarMedicao(medicao, hojeISO) {
  if (!medicao) {
    return { status: STATUS_PENDENTE, dias_restantes: null };
  }
  const validadeISO = isoDeData(medicao.validade);
  if (!validadeISO) {
    return { status: STATUS_PENDENTE, dias_restantes: null };
  }
  const dias = diferencaEmDias(validadeISO, hojeISO);
  if (dias < 0) return { status: STATUS_VENCIDO, dias_restantes: dias };
  if (dias <= DIAS_ALERTA) return { status: STATUS_ALERTA, dias_restantes: dias };
  return { status: STATUS_CONFORME, dias_restantes: dias };
}

function percentual(parte, total) {
  if (!total) return 0;
  return Math.round((parte / total) * 1000) / 10;
}

function montarLinha(veiculo, medicao, hojeISO) {
  const classificacao = classificarMedicao(medicao, hojeISO);
  return {
    tag: veiculo.tag,
    placa: veiculo.placa,
    modelo: veiculo.modelo,
    contrato: veiculo.contrato,
    data_medicao: isoDeData(medicao?.data_medicao),
    validade: isoDeData(medicao?.validade),
    dias_restantes: classificacao.dias_restantes,
    status: classificacao.status,
    observacao: medicao?.observacao || null,
    atualizado_em: medicao?.updated_at || null,
  };
}

function montarResumo(lista) {
  const total = lista.length;
  const emConformidade = lista.filter((v) => v.status === STATUS_CONFORME).length;
  const emAlerta = lista.filter((v) => v.status === STATUS_ALERTA).length;
  const vencidos = lista.filter((v) => v.status === STATUS_VENCIDO).length;
  const pendentes = lista.filter((v) => v.status === STATUS_PENDENTE).length;
  const comMedicao = total - pendentes;

  return {
    total_mobilizado: total,
    em_conformidade: emConformidade,
    em_alerta: emAlerta,
    vencidos,
    pendentes,
    com_medicao: comMedicao,
    cobertura_percentual: percentual(comMedicao, total),
    conformidade_percentual: percentual(emConformidade, total),
    alerta_percentual: percentual(emAlerta, total),
    vencidos_percentual: percentual(vencidos, total),
    pendentes_percentual: percentual(pendentes, total),
  };
}

export const obterPainelFumacaPreta = asyncHandler(async (req, res) => {
  const hojeISO = hojeISOOperacao();

  const veiculos = await prisma.mobDesmob.findMany({
    where: { status: 'Mobilizado', deletado_em: null },
    select: {
      tag: true,
      placa: true,
      modelo: true,
      contrato: true,
      monitoramento_fumaca: {
        select: {
          data_medicao: true,
          validade: true,
          observacao: true,
          updated_at: true,
        },
      },
    },
    orderBy: [{ contrato: 'asc' }, { tag: 'asc' }],
  });

  const lista = veiculos.map((veiculo) => montarLinha(veiculo, veiculo.monitoramento_fumaca, hojeISO));

  res.json({
    data: {
      referencia: hojeISO,
      atualizado_em: new Date().toISOString(),
      resumo: montarResumo(lista),
      veiculos: lista,
    },
  });
});

export const salvarMedicaoFumacaPreta = asyncHandler(async (req, res) => {
  const tag = String(req.body?.tag ?? '').trim();
  if (!tag) {
    return res.status(400).json({
      error: 'Dados inválidos',
      message: 'A TAG do veículo é obrigatória.',
    });
  }

  const dataMedicao = validarDataISO(req.body?.data_medicao);
  if (!dataMedicao) {
    return res.status(400).json({
      error: 'Data inválida',
      message: 'Informe a data da medição no formato AAAA-MM-DD.',
    });
  }

  const observacaoBruta = req.body?.observacao;
  if (observacaoBruta !== undefined && observacaoBruta !== null && typeof observacaoBruta !== 'string') {
    return res.status(400).json({
      error: 'Dados inválidos',
      message: 'A observação deve ser um texto.',
    });
  }
  const observacao = String(observacaoBruta ?? '').trim();
  if (observacao.length > TAMANHO_MAX_OBSERVACAO) {
    return res.status(400).json({
      error: 'Dados inválidos',
      message: `A observação deve ter no máximo ${TAMANHO_MAX_OBSERVACAO} caracteres.`,
    });
  }

  const veiculo = await prisma.mobDesmob.findFirst({
    where: { tag, status: 'Mobilizado', deletado_em: null },
    select: { tag: true, placa: true, modelo: true, contrato: true },
  });
  if (!veiculo) {
    return res.status(404).json({
      error: 'Veículo não encontrado',
      message: 'A TAG informada não pertence a um veículo mobilizado e ativo.',
    });
  }

  const validadeISO = adicionarMesesISO(dataMedicao.iso, MESES_VALIDADE);
  const existente = await prisma.monitoramentoFumacaPreta.findUnique({
    where: { tag },
    select: { id: true },
  });

  const registro = await prisma.monitoramentoFumacaPreta.upsert({
    where: { tag },
    create: {
      tag,
      data_medicao: dataMedicao.data,
      validade: dataUTC(validadeISO),
      observacao: observacao || null,
    },
    update: {
      data_medicao: dataMedicao.data,
      validade: dataUTC(validadeISO),
      observacao: observacao || null,
    },
  });

  const hojeISO = hojeISOOperacao();
  const linha = montarLinha(veiculo, registro, hojeISO);

  res.status(existente ? 200 : 201).json({
    data: {
      criado: !existente,
      veiculo: linha,
    },
    message: existente
      ? 'Medição atualizada com sucesso.'
      : 'Medição lançada com sucesso.',
  });
});
