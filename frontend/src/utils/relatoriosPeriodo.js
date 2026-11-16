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

export async function criarPacoteRelatorios(sessao, periodo, {
  gerarPdf, onProgresso = () => {}, signal,
} = {}) {
  onProgresso({ etapa: 'consulta', concluidos: 0, total: 0 });
  const partes = await carregarPartesDoPeriodo(sessao, periodo, { signal });
  if (!partes.length) throw new Error('Nenhum relatório encontrado para o período selecionado.');
  const arquivos = planejarArquivosRelatorios(partes);
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [indice, arquivo] of arquivos.entries()) {
    verificarCancelamento(signal);
    const { parte, obra, caminho } = arquivo;
    onProgresso({ etapa: 'gerando', concluidos: indice, total: arquivos.length, obra, tag: parte.tag });
    try {
      // A listagem contém apenas resumos; cada PDF recebe o relatório completo.
      const resposta = await fetch(`/api/partes-diarias/${encodeURIComponent(parte.id)}`, {
        headers: authHeaders(sessao), cache: 'no-store', signal,
      });
      if (!resposta.ok) throw new Error(`Não foi possível carregar o relatório (${resposta.status}).`);
      const { data: completo } = await resposta.json();
      if (!completo || completo.id !== parte.id
        || !filtrarPartesDiarias([completo], sessao.usuario).length) {
        throw new Error('O relatório não está disponível para este usuário.');
      }
      verificarCancelamento(signal);
      const pdf = await gerarPdf(completo, { signal });
      verificarCancelamento(signal);
      zip.file(caminho, pdf);
    } catch (erro) {
      verificarCancelamento(signal);
      throw new Error(`${obra} • ${parte.tag || 'Sem TAG'} • ${diaRelatorio(parte)}: ${erro.message} Nenhum ZIP foi baixado.`);
    }
  }
  verificarCancelamento(signal);
  const progresso = { etapa: 'compactando', concluidos: arquivos.length, total: arquivos.length };
  onProgresso({ ...progresso, percentual: 0 });
  const conteudo = await zip.generateAsync({
    type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 }, streamFiles: true,
  }, ({ percent }) => {
    verificarCancelamento(signal);
    onProgresso({ ...progresso, percentual: Math.round(percent) });
  });
  verificarCancelamento(signal);
  return {
    conteudo, total: arquivos.length, obras: new Set(arquivos.map((arquivo) => arquivo.pasta)).size,
    nome: `Relatorios_Oficiais_${periodo.dataInicio}_a_${periodo.dataFim}.zip`,
  };
}
