import { extrairPartesData, formatarDataSemTimezone } from './datas.js';

const DIAS = ['Domingo', 'Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira', 'Sábado'];

export function diaSemanaDe(valor) {
  const data = extrairPartesData(valor);
  return data ? DIAS[new Date(Date.UTC(Number(data.ano), Number(data.mes) - 1, Number(data.dia))).getUTCDay()] : '—';
}
export const formatarDataBR = formatarDataSemTimezone;

export function formatarDataHora(valor) {
  const data = valor ? new Date(valor) : null;
  return data && !Number.isNaN(data.getTime()) ? data.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—';
}

export function calcHorasTrabalhadas(entrada, saida, intervaloEntrada, intervaloSaida) {
  const minutos = (valor) => {
    if (!valor || !String(valor).includes(':')) return null;
    const [h, m] = String(valor).split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  const inicio = minutos(entrada), fim = minutos(saida);
  if (inicio === null || fim === null) return '—';
  let total = (fim - inicio + 1440) % 1440;
  const pausaInicio = minutos(intervaloEntrada), pausaFim = minutos(intervaloSaida);
  if (pausaInicio !== null && pausaFim !== null) total -= (pausaFim - pausaInicio + 1440) % 1440;
  total = Math.max(total, 0);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function rotuloStatus(statusRelatorio, assinaturas = [], modelo = '') {
  const etapas = new Set(assinaturas.map((a) => String(a.etapa || '').toUpperCase()));
  if (statusRelatorio === 'APROVADO') return 'Aprovado';
  const categoria = String(modelo).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  if (['ONIBUS', 'VAN'].includes(categoria)) {
    return etapas.has('TRANSPORTE') ? 'Aprovado' : etapas.has('OPERADOR') ? 'Finalizado pelo Operador' : 'Em Preenchimento';
  }
  return etapas.has('PLANEJADOR') ? 'Aprovado' : etapas.has('TRANSPORTE') ? 'Revisado pelo Transporte'
    : etapas.has('OPERADOR') ? 'Finalizado pelo Operador' : 'Em Preenchimento';
}

export function montarModeloRelatorio(parte) {
  const maoObra = parte.mao_obra || [];
  const equipamentos = parte.equipamentos || [];
  const autor = {
    nome: parte.funcionario || parte.criado_por || maoObra[0]?.nome || '',
    matricula: parte.operador || maoObra[0]?.matricula || '',
    funcao: parte.funcao || maoObra[0]?.funcao || '',
  };
  const modelo = (typeof parte.veiculo === 'string' ? parte.veiculo : parte.veiculo?.modelo)
    || equipamentos.find((e) => String(e.descricao || '').trim())?.descricao || '';
  return {
    ...parte,
    numero: parte.numero_relatorio || parte.id?.split('-')[0]?.toUpperCase() || '—',
    diaSemana: diaSemanaDe(parte.data), dataFormatada: formatarDataBR(parte.data),
    horas: calcHorasTrabalhadas(parte.horario_entrada, parte.horario_saida, parte.intervalo_entrada, parte.intervalo_saida),
    jornada: parte.horario_entrada && parte.horario_saida ? `${parte.horario_entrada} - ${parte.horario_saida}` : parte.horario_entrada || '—',
    intervalo: parte.intervalo_entrada && parte.intervalo_saida ? `${parte.intervalo_entrada} - ${parte.intervalo_saida}` : parte.intervalo_entrada || '—',
    statusLabel: rotuloStatus(parte.status_relatorio, parte.assinaturas || [], modelo),
    statusOp: parte.status_operacional || parte.status || '—',
    maoObra: maoObra.length ? maoObra.map((pessoa, indice) => indice ? pessoa : {
      ...pessoa, nome: autor.nome || pessoa.nome, matricula: autor.matricula || pessoa.matricula,
      funcao: autor.funcao || pessoa.funcao,
    }) : autor.nome || autor.matricula ? [autor] : [],
    equipamentos: equipamentos.length ? equipamentos : parte.tag ? [{ tag_patrimonio: parte.tag, descricao: modelo, status: '' }] : [],
    atividades: parte.atividades || [], ocorrencias: parte.ocorrencias || [],
    fotos: parte.fotos || [], assinaturas: parte.assinaturas || [],
  };
}
