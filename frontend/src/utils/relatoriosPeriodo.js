import { authHeaders } from './sessao.js';
import { filtrarPartesDiarias } from './partesDiarias.js';
import { extrairPartesData } from './datas.js';

export function verificarCancelamento(signal) {
  if (signal?.aborted) throw new DOMException('Exportação cancelada.', 'AbortError');
}

function dataValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor || '')) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

export function validarPeriodoRelatorios({ dataInicio, dataFim } = {}) {
  if (!dataValida(dataInicio) || !dataValida(dataFim)) {
    throw new Error('Informe as datas inicial e final do período.');
  }
  if (dataInicio > dataFim) throw new Error('A data final deve ser igual ou posterior à data inicial.');
}

function diaRelatorio(parte) {
  const dia = extrairPartesData(parte.data);
  return dia ? `${dia.ano}-${dia.mes}-${dia.dia}` : '';
}

// Consulta independente dos filtros/páginas carregados na tabela do Início.
// O JWT acompanha todas as chamadas; o escopo do operacional é reaplicado.
export async function carregarPartesDoPeriodo(sessao, periodo, { signal } = {}) {
  validarPeriodoRelatorios(periodo);
  if (!sessao?.token || !sessao?.usuario) throw new Error('Faça login para exportar os relatórios.');
  const partes = new Map();
  let paginas = 1;
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    verificarCancelamento(signal);
    const params = new URLSearchParams({
      data_inicio: periodo.dataInicio, data_fim: periodo.dataFim,
      limit: '100', page: String(pagina),
    });
    const resposta = await fetch(`/api/partes-diarias?${params}`, {
      headers: authHeaders(sessao), cache: 'no-store', signal,
    });
    if (!resposta.ok) throw new Error(`Não foi possível consultar as Partes Diárias (${resposta.status}).`);
    const corpo = await resposta.json();
    if (!Array.isArray(corpo.data) || corpo.data.some((parte) => !parte?.id)) {
      throw new Error('A consulta retornou relatórios inválidos. Tente novamente.');
    }
    corpo.data.forEach((parte) => partes.set(parte.id, parte));
    paginas = Number(corpo.pagination?.pages) || 1;
    if (!Number.isSafeInteger(paginas) || paginas < 1) throw new Error('Paginação de relatórios inválida.');
  }
  verificarCancelamento(signal);
  return filtrarPartesDiarias([...partes.values()], sessao.usuario).filter((parte) => {
    const dia = diaRelatorio(parte);
    return dia >= periodo.dataInicio && dia <= periodo.dataFim;
  });
}

function nomeSeguro(valor, padrao, limite = 90) {
  const nome = String(valor || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '').slice(0, limite).replace(/[.\s]+$/g, '') || padrao;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(nome) ? `_${nome}` : nome;
}

// Usa o ID da obra quando disponível e evita colisões de nomes no ZIP,
// inclusive obras distintas com o mesmo nome e duas partes da mesma TAG/dia.
export function planejarArquivosRelatorios(partes) {
  const pastas = new Map();
  const pastasUsadas = new Set();
  const arquivosUsados = new Set();
  const idsPorNome = new Map();
  const nomeObra = (parte) => String(parte.obra || parte.obra_ref?.nome || '').trim() || 'Sem obra';
  const chaveNome = (parte) => nomeObra(parte).toLocaleUpperCase('pt-BR');
  for (const parte of partes) {
    const id = parte.obra_id || parte.obra_ref?.id;
    if (!id) continue;
    const nome = chaveNome(parte);
    if (!idsPorNome.has(nome)) idsPorNome.set(nome, new Set());
    idsPorNome.get(nome).add(id);
  }
  const comparar = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' }).compare;
  return [...partes].sort((a, b) => comparar(a.obra || a.obra_ref?.nome || '', b.obra || b.obra_ref?.nome || '')
    || comparar(diaRelatorio(a), diaRelatorio(b)) || comparar(a.tag || '', b.tag || '')
    || comparar(a.id, b.id)).map((parte) => {
    const obra = nomeObra(parte);
    const ids = idsPorNome.get(chaveNome(parte));
    // Registros legados sem FK se juntam à obra de mesmo nome quando o
    // vínculo é inequívoco. Obras homônimas com IDs diferentes ficam separadas.
    const obraId = parte.obra_id || parte.obra_ref?.id || (ids?.size === 1 ? [...ids][0] : null);
    const chave = obraId ? `obra:${obraId}` : `nome:${chaveNome(parte)}`;
    if (!pastas.has(chave)) {
      const base = nomeSeguro(obra, 'Sem obra');
      let pasta = base;
      let sufixo = 2;
      while (pastasUsadas.has(pasta.toLowerCase())) pasta = `${base} (${sufixo++})`;
      pastasUsadas.add(pasta.toLowerCase());
      pastas.set(chave, pasta);
    }
    const pasta = pastas.get(chave);
    const tag = nomeSeguro(parte.tag, 'SEM_TAG', 24);
    const numero = nomeSeguro(parte.numero_relatorio || parte.id_relatorio, 'RELATORIO', 32);
    const id = nomeSeguro(parte.id, 'ID', 36);
    const base = `Parte_Diaria_${diaRelatorio(parte)}_${tag}_${numero}_${id}`;
    let caminho = `${pasta}/${base}.pdf`;
    let sufixo = 2;
    while (arquivosUsados.has(caminho.toLowerCase())) caminho = `${pasta}/${base}_${sufixo++}.pdf`;
    arquivosUsados.add(caminho.toLowerCase());
    return { parte, obra, pasta, caminho };
  });
}

export const TAMANHO_LOTE_PDF = 25;

export async function processarRelatoriosEmLotes(sessao, periodo, {
  processarLote, onProgresso = () => {}, signal,
} = {}) {
  onProgresso({ etapa: 'consulta', concluidos: 0, total: 0 });
  const partes = await carregarPartesDoPeriodo(sessao, periodo, { signal });
  if (!partes.length) throw new Error('Nenhum relatório encontrado para o período selecionado.');
  const arquivos = planejarArquivosRelatorios(partes);
  const consultar = async (inicio) => {
    verificarCancelamento(signal);
    const lote = arquivos.slice(inicio, inicio + TAMANHO_LOTE_PDF);
    const resposta = await fetch('/api/partes-diarias/exportacao/lote', {
      method: 'POST', headers: authHeaders(sessao), cache: 'no-store', signal,
      body: JSON.stringify({ ids: lote.map(({ parte }) => parte.id) }),
    });
    if (!resposta.ok) {
      const erro = await resposta.json().catch(() => ({}));
      throw new Error(erro.message || `Não foi possível carregar o lote de relatórios (${resposta.status}).`);
    }
    const { data } = await resposta.json();
    const permitidos = Array.isArray(data) && data.every((parte) => parte && typeof parte.id === 'string')
      ? filtrarPartesDiarias(data, sessao.usuario) : [];
    const porId = new Map(permitidos.map((parte) => [parte.id, parte]));
    if (!Array.isArray(data) || data.length !== lote.length || porId.size !== lote.length
      || lote.some(({ parte }) => !porId.has(parte.id))) {
      throw new Error('O lote está incompleto ou contém relatórios indisponíveis para este usuário. Nenhum ZIP foi baixado.');
    }
    verificarCancelamento(signal);
    return lote.map(({ parte, ...arquivo }) => ({ ...arquivo, relatorio: porId.get(parte.id) }));
  };
  const adiantar = (inicio) => consultar(inicio).then((lote) => ({ lote }), (erro) => ({ erro }));
  let pendente = adiantar(0);
  for (let inicio = 0; inicio < arquivos.length; inicio += TAMANHO_LOTE_PDF) {
    verificarCancelamento(signal);
    onProgresso({ etapa: 'carregando', concluidos: inicio, total: arquivos.length,
      ate: Math.min(arquivos.length, inicio + TAMANHO_LOTE_PDF) });
    const preparado = await pendente;
    if (preparado.erro) throw preparado.erro;
    verificarCancelamento(signal);
    const proximo = inicio + TAMANHO_LOTE_PDF;
    pendente = proximo < arquivos.length ? adiantar(proximo) : null;
    await processarLote(preparado.lote, { total: arquivos.length, signal });
  }
  verificarCancelamento(signal);
  return {
    total: arquivos.length, obras: new Set(arquivos.map((arquivo) => arquivo.pasta)).size,
    nome: `Relatorios_Oficiais_${periodo.dataInicio}_a_${periodo.dataFim}.zip`,
  };
}
