// ============================================================================
// Motor do modo offline: intercepta o fetch das telas para /api.
//  - GET de listagens principais: Network First; sem rede, devolve a última
//    cópia do IndexedDB (já mesclada com as alterações ainda na fila).
//  - Mutações permitidas (ver regras.js): sem rede, entram na fila
//    `offline_queue` e a tela recebe a resposta que espera do servidor.
//  - sincronizar(): reenvia a fila em ordem quando a conexão volta.
// ============================================================================
import {
  aplicarPendencias, classificarResposta, leituraCacheavel, MAX_TENTATIVAS,
  PREFIXO_ID_LOCAL, regraDaMutacao,
} from './regras.js';

export const EVENTO_SINCRONIZADO = 'omega:sincronizado';

function erroDeRede(erro) {
  // fetch rejeita com TypeError quando não há rede; AbortError é cancelamento da tela.
  return erro instanceof TypeError && erro.name !== 'AbortError';
}

function respostaJson(corpo, status = 200, extras = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...extras },
  });
}

function idLocal() {
  const aleatorio = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${PREFIXO_ID_LOCAL}${aleatorio}`;
}

export function criarMotorOffline({
  armazenamento,
  fetchOriginal,
  obterUsuario,
  obterHeaders,
  origem = globalThis.location?.origin || 'http://localhost',
  estaOnline = () => globalThis.navigator?.onLine !== false,
  agora = () => Date.now(),
  emitirEvento = (nome, detalhe) => globalThis.dispatchEvent?.(new CustomEvent(nome, { detail: detalhe })),
}) {
  let estado = {
    online: estaOnline(),
    servindoCache: false,
    cacheSalvoEm: null,
    pendentes: 0,
    sincronizando: false,
    precisaLogin: false,
    ultimoResultado: null,
  };
  const ouvintes = new Set();
  const atualizar = (parcial) => {
    estado = { ...estado, ...parcial };
    ouvintes.forEach((fn) => fn(estado));
  };

  async function filaDoUsuario() {
    const usuario = obterUsuario();
    try {
      return (await armazenamento.listarFila()).filter((item) => item.usuario === usuario);
    } catch {
      return [];
    }
  }

  async function atualizarPendentes() {
    atualizar({ pendentes: (await filaDoUsuario()).length });
  }

  async function lerComCache(input, init, caminho) {
    const chave = `${obterUsuario() || 'anonimo'}|${caminho}`;
    try {
      const resposta = await fetchOriginal(input, init);
      if (!resposta.ok || !(resposta.headers.get('content-type') || '').includes('application/json')) return resposta;
      const corpo = await resposta.clone().json();
      armazenamento.gravarCache({ chave, corpo, salvoEm: agora() }).catch(() => {});
      if (estado.servindoCache || !estado.online) atualizar({ servindoCache: false, cacheSalvoEm: null, online: true });
      const fila = await filaDoUsuario();
      return fila.length ? respostaJson(aplicarPendencias(caminho, corpo, fila), resposta.status) : resposta;
    } catch (erro) {
      if (!erroDeRede(erro)) throw erro;
      const registro = await armazenamento.lerCache(chave).catch(() => null);
      if (!registro) {
        atualizar({ online: false });
        throw new TypeError('Sem conexão e sem dados salvos neste computador para esta tela.');
      }
      atualizar({ online: false, servindoCache: true, cacheSalvoEm: registro.salvoEm });
      const fila = await filaDoUsuario();
      return respostaJson(aplicarPendencias(caminho, registro.corpo, fila), 200, {
        'X-Omega-Offline': 'cache',
        'X-Omega-Salvo-Em': new Date(registro.salvoEm).toISOString(),
      });
    }
  }

  async function enfileirar(regra, caminho, metodo, init) {
    const corpo = init.body ? JSON.parse(init.body) : null;
    const item = {
      usuario: obterUsuario(),
      tipo: regra.tipo,
      metodo,
      caminho,
      corpo,
      descricao: regra.descrever(corpo),
      criadoEm: agora(),
      tentativas: 0,
      ...(regra.tipo === 'terceiro-criar' ? { idLocal: idLocal() } : {}),
    };
    item.id = await armazenamento.adicionarFila(item);
    await atualizarPendentes();
    const { status, corpo: corpoResposta } = regra.resposta(corpo, item);
    return status === 204
      ? new Response(null, { status, headers: { 'X-Omega-Offline': 'fila' } })
      : respostaJson(corpoResposta, status, { 'X-Omega-Offline': 'fila' });
  }

  // Excluir um terceiro que só existe na fila = desfazer o cadastro local.
  async function cancelarCriacaoLocal(id) {
    const fila = await filaDoUsuario();
    const criacao = fila.find((item) => item.tipo === 'terceiro-criar' && item.idLocal === id);
    if (criacao) await armazenamento.removerFila(criacao.id);
    await atualizarPendentes();
    return new Response(null, { status: criacao ? 204 : 404, headers: { 'X-Omega-Offline': 'fila' } });
  }

  async function fetchInterceptado(input, init = {}) {
    const bruto = typeof input === 'string' ? input : input instanceof URL ? input.href : null;
    if (!bruto) return fetchOriginal(input, init);
    const url = new URL(bruto, origem);
    if (url.origin !== origem || !url.pathname.startsWith('/api/')) return fetchOriginal(input, init);

    const metodo = String(init.method || 'GET').toUpperCase();
    const caminho = url.pathname + url.search;
    if (metodo === 'GET') {
      return leituraCacheavel(caminho) ? lerComCache(input, init, caminho) : fetchOriginal(input, init);
    }

    const regra = regraDaMutacao(metodo, url.pathname);
    // Uploads (FormData) e mutações fora da lista exigem conexão.
    if (!regra || (init.body != null && typeof init.body !== 'string')) return fetchOriginal(input, init);

    if (regra.tipo === 'terceiro-excluir') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      if (id.startsWith(PREFIXO_ID_LOCAL)) return cancelarCriacaoLocal(id);
    }

    // Ordem garantida: com itens pendentes, a nova alteração só vai ao servidor
    // depois deles (senão um lote antigo sobrescreveria um novo).
    if ((await filaDoUsuario()).length) {
      await sincronizar();
      if ((await filaDoUsuario()).length) return enfileirar(regra, url.pathname, metodo, init);
    }
    try {
      return await fetchOriginal(input, init);
    } catch (erro) {
      if (!erroDeRede(erro)) throw erro;
      atualizar({ online: false });
      try {
        return await enfileirar(regra, url.pathname, metodo, init);
      } catch {
        throw erro; // sem IndexedDB: a tela mostra a falha de rede original
      }
    }
  }

  let emAndamento = null;
  function sincronizar() {
    if (!emAndamento) {
      emAndamento = executarSincronizacao().finally(() => { emAndamento = null; });
    }
    return emAndamento;
  }

  async function executarSincronizacao() {
    const fila = await filaDoUsuario();
    if (!fila.length || !obterUsuario()) {
      atualizar({ pendentes: fila.length });
      return { enviados: 0, rejeitados: [], parou: null };
    }
    atualizar({ sincronizando: true });
    let enviados = 0;
    let parou = null;
    const rejeitados = [];
    for (const item of fila) {
      let resposta;
      try {
        resposta = await fetchOriginal(item.caminho, {
          method: item.metodo,
          headers: obterHeaders(),
          body: item.corpo == null ? undefined : JSON.stringify(item.corpo),
        });
      } catch {
        parou = 'rede';
        break;
      }
      let classe = classificarResposta(resposta.status);
      if (item.tipo === 'terceiro-excluir' && resposta.status === 404) classe = 'ok'; // já excluído
      if (classe === 'ok') {
        await armazenamento.removerFila(item.id);
        enviados += 1;
        continue;
      }
      if (classe === 'login') { parou = 'login'; break; }
      const corpoErro = await resposta.json().catch(() => ({}));
      if (classe === 'repetir') {
        const tentativas = (item.tentativas || 0) + 1;
        if (tentativas < MAX_TENTATIVAS) {
          await armazenamento.atualizarFila({ ...item, tentativas });
          parou = 'servidor';
          break;
        }
      }
      await armazenamento.removerFila(item.id);
      rejeitados.push({ descricao: item.descricao, mensagem: corpoErro.message || `Servidor respondeu ${resposta.status}.` });
    }
    const pendentes = (await filaDoUsuario()).length;
    const resultado = { enviados, rejeitados, parou };
    atualizar({
      sincronizando: false,
      pendentes,
      online: parou !== 'rede',
      precisaLogin: parou === 'login',
      ...(enviados || rejeitados.length ? { ultimoResultado: { ...resultado, em: agora() } } : {}),
    });
    if (enviados || rejeitados.length) emitirEvento(EVENTO_SINCRONIZADO, resultado);
    return resultado;
  }

  return {
    fetch: fetchInterceptado,
    sincronizar,
    atualizarPendentes,
    obterEstado: () => estado,
    definirOnline: (online) => atualizar({ online }),
    limparResultado: () => atualizar({ ultimoResultado: null }),
    assinar(fn) {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },
  };
}
