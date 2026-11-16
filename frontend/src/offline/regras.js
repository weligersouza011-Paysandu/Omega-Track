// ============================================================================
// Regras do modo offline (funções puras, sem rede nem IndexedDB).
// ============================================================================

// Leituras principais guardadas no IndexedDB (Network First -> cache local).
const LEITURAS_CACHEAVEIS = [
  /^\/api\/programacao-recursos(\?|$)/,
  /^\/api\/mob-desmob(\?|\/|$)/,
  /^\/api\/veiculos-terceiros(\?|$)/,
  /^\/api\/obras(\?|$)/,
  /^\/api\/documentacao-veiculos(\?|\/|$)/,
  /^\/api\/parametros-preventiva(\?|\/|$)/,
  /^\/api\/manutencao\//,
  /^\/api\/partes-diarias(\?|$)/,
  /^\/api\/partes-diarias\/obra-programada\?/,
  /^\/api\/categorias-desvio(\?|$)/,
  /^\/api\/eficiencia(\?|\/|$)/,
];

export function leituraCacheavel(caminho) {
  return LEITURAS_CACHEAVEIS.some((padrao) => padrao.test(caminho));
}

function dataBR(iso) {
  const [ano, mes, dia] = String(iso || '').split('-');
  return dia ? `${dia}/${mes}/${ano}` : iso;
}

// Mutações que podem ser feitas sem rede. Cada regra sabe descrever a alteração
// para o usuário e devolver a resposta que a tela espera do servidor.
export const MUTACOES_OFFLINE = [
  {
    tipo: 'programacao-lote',
    metodo: 'PUT',
    padrao: /^\/api\/programacao-recursos\/lote$/,
    descrever: (corpo) => `Programação de ${dataBR(corpo?.data)} (${corpo?.alteracoes?.length || 0} alteração(ões))`,
    resposta: (corpo) => ({ status: 200, corpo: { data: { data: corpo.data, salvas: corpo.alteracoes.length }, offline: true } }),
  },
  {
    tipo: 'terceiro-criar',
    metodo: 'POST',
    padrao: /^\/api\/veiculos-terceiros$/,
    descrever: (corpo) => `Cadastro do veículo terceiro ${String(corpo?.tag || '').toUpperCase()}`,
    resposta: (corpo, item) => ({
      status: 201,
      corpo: { data: veiculoTerceiroLocal(corpo, item), offline: true },
    }),
  },
  {
    tipo: 'terceiro-excluir',
    metodo: 'DELETE',
    padrao: /^\/api\/veiculos-terceiros\/([^/?]+)$/,
    descrever: () => 'Exclusão de veículo terceiro',
    resposta: () => ({ status: 204, corpo: null }),
  },
];

export function regraDaMutacao(metodo, caminho) {
  const m = String(metodo || 'GET').toUpperCase();
  return MUTACOES_OFFLINE.find((regra) => regra.metodo === m && regra.padrao.test(caminho)) || null;
}

export const PREFIXO_ID_LOCAL = 'local-';

function veiculoTerceiroLocal(corpo, item) {
  const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    id: item.idLocal,
    tag: String(corpo?.tag || '').trim().toUpperCase(),
    tipo: String(corpo?.tipo || '').trim(),
    empresa_terceira: texto(corpo?.empresa_terceira),
    placa: texto(corpo?.placa)?.toUpperCase() ?? null,
    modelo: texto(corpo?.modelo),
    foto_url: texto(corpo?.foto_url),
    observacao: texto(corpo?.observacao),
    created_at: new Date(item.criadoEm).toISOString(),
    pendenteSync: true,
  };
}

// ---------------------------------------------------------------------------
// Mescla da fila pendente nas leituras (cache ou rede): a tela mostra o que o
// usuário já fez offline, mesmo antes de o servidor receber.
// ---------------------------------------------------------------------------

function idExcluido(item) {
  return item.tipo === 'terceiro-excluir' ? decodeURIComponent(item.caminho.split('/').pop()) : null;
}

export function aplicarPendencias(caminho, corpo, fila) {
  if (!fila?.length || !corpo || typeof corpo !== 'object') return corpo;
  if (/^\/api\/veiculos-terceiros(\?|$)/.test(caminho)) return aplicarPendenciasTerceiros(corpo, fila);
  if (/^\/api\/programacao-recursos(\?|$)/.test(caminho)) return aplicarPendenciasProgramacao(corpo, fila);
  return corpo;
}

function aplicarPendenciasTerceiros(corpo, fila) {
  if (!Array.isArray(corpo.data)) return corpo;
  const excluidos = new Set(fila.map(idExcluido).filter(Boolean));
  const criados = fila
    .filter((item) => item.tipo === 'terceiro-criar')
    .map((item) => veiculoTerceiroLocal(item.corpo, item));
  const tags = new Set(corpo.data.map((v) => v.tag));
  return {
    ...corpo,
    data: [
      ...corpo.data.filter((v) => !excluidos.has(v.id)),
      ...criados.filter((v) => !tags.has(v.tag)),
    ],
  };
}

function aplicarPendenciasProgramacao(corpo, fila) {
  const dados = corpo.data;
  if (!dados || !Array.isArray(dados.equipamentos)) return corpo;
  const pessoas = new Map((dados.pessoas || []).map((p) => [p.matricula, p.nome]));
  let equipamentos = dados.equipamentos.map((e) => ({ ...e }));

  // Terceiros: cadastros offline já aparecem para alocação; exclusões somem.
  const excluidos = new Set(fila.map(idExcluido).filter(Boolean));
  equipamentos = equipamentos.filter((e) => !(e.is_terceiro && excluidos.has(e.terceiroId)));
  const tags = new Set(equipamentos.map((e) => e.tag));
  for (const item of fila) {
    if (item.tipo !== 'terceiro-criar') continue;
    const v = veiculoTerceiroLocal(item.corpo, item);
    if (tags.has(v.tag)) continue;
    tags.add(v.tag);
    equipamentos.push({
      tag: v.tag, placa: v.placa, modelo: v.tipo, contrato: v.empresa_terceira, status: 'Terceiro',
      is_terceiro: true, terceiroId: v.id, empresaTerceira: v.empresa_terceira, modeloVeiculo: v.modelo,
      fotoUrl: v.foto_url, manutencaoAtiva: null, manutencaoNoDia: null, obraId: null,
      operadorMatricula: null, operadorNome: null, supervisorMatricula: null, supervisorNome: null,
      atualizadoEm: null, pendenteSync: true,
    });
  }

  // Lotes da mesma data, na ordem em que foram feitos.
  const porTag = new Map(equipamentos.map((e) => [e.tag, e]));
  for (const item of fila) {
    if (item.tipo !== 'programacao-lote' || item.corpo?.data !== dados.data) continue;
    for (const alteracao of item.corpo.alteracoes || []) {
      const equipamento = porTag.get(alteracao.tag);
      if (!equipamento || equipamento.manutencaoAtiva) continue;
      equipamento.obraId = alteracao.obraId;
      for (const prefixo of ['operador', 'operadorTarde', 'supervisor']) {
        const campo = `${prefixo}Matricula`;
        if (alteracao.obraId === null) {
          equipamento[campo] = null;
          equipamento[`${prefixo}Nome`] = null;
        } else if (alteracao[campo] !== undefined) {
          equipamento[campo] = alteracao[campo];
          equipamento[`${prefixo}Nome`] = alteracao[campo] ? pessoas.get(alteracao[campo]) || null : null;
        }
      }
      equipamento.pendenteSync = true;
    }
  }
  return { ...corpo, data: { ...dados, equipamentos } };
}

// Classifica a resposta do servidor ao reenviar um item da fila.
//   'ok'        -> remover da fila
//   'login'     -> sessão expirada: manter e pausar até novo login
//   'repetir'   -> erro temporário (5xx/429): manter e tentar depois
//   'rejeitado' -> o servidor recusou (4xx): remover e avisar o usuário
export function classificarResposta(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'login';
  if (status === 408 || status === 429 || status >= 500) return 'repetir';
  return 'rejeitado';
}

export const MAX_TENTATIVAS = 5;
