// Executado no Web Worker. Cada mídia é obtida/decodificada uma vez e
// reutilizada nos relatórios seguintes, com limite de memória e concorrência.
export async function carregarImagemPdf(url) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new Error('Seu navegador não suporta a geração rápida. Use uma versão atual do Chrome, Edge ou Firefox.');
  }
  const controller = new AbortController();
  const temporizador = setTimeout(() => controller.abort(), 20000);
  let bitmap;
  try {
    const endereco = new URL(url, globalThis.location?.origin || 'http://localhost').href;
    const resposta = await fetch(endereco, { signal: controller.signal, credentials: 'omit', cache: 'force-cache' });
    if (!resposta.ok) throw new Error(`Imagem indisponível (${resposta.status}).`);
    bitmap = await createImageBitmap(await resposta.blob());
    const escala = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = new OffscreenCanvas(largura, altura);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const dados = new Uint8Array(await blob.arrayBuffer());
    canvas.width = 0; canvas.height = 0;
    return { dados, largura, altura, formato: 'JPEG' };
  } catch (erro) {
    throw new Error(erro.name === 'AbortError' ? 'Uma foto ou assinatura demorou demais para carregar.'
      : `Não foi possível carregar uma foto ou assinatura: ${erro.message}`);
  } finally {
    bitmap?.close();
    clearTimeout(temporizador);
  }
}

export function criarCacheImagensPdf({ carregar = carregarImagemPdf, concorrencia = 4, limiteBytes = 32 * 1024 * 1024 } = {}) {
  const cache = new Map();
  const fila = [];
  let ativas = 0, bytes = 0;
  const executar = () => {
    while (ativas < concorrencia && fila.length) {
      const tarefa = fila.shift();
      ativas += 1;
      Promise.resolve().then(tarefa.executar).then(tarefa.resolve, tarefa.reject).finally(() => { ativas -= 1; executar(); });
    }
  };
  const agendar = (fn) => new Promise((resolve, reject) => { fila.push({ executar: fn, resolve, reject }); executar(); });
  return {
    obter(url) {
      if (!url || typeof url !== 'string') return Promise.reject(new Error('Uma imagem do relatório está sem endereço.'));
      if (cache.has(url)) {
        const entrada = cache.get(url);
        cache.delete(url); cache.set(url, entrada);
        return entrada.promessa;
      }
      const entrada = { tamanho: 0 };
      entrada.promessa = agendar(() => carregar(url)).then((imagem) => {
        entrada.tamanho = imagem.dados.byteLength;
        bytes += entrada.tamanho;
        for (const [chave, antiga] of cache) {
          if (bytes <= limiteBytes) break;
          if (!antiga.tamanho) continue;
          cache.delete(chave); bytes -= antiga.tamanho;
        }
        return imagem;
      }).catch((erro) => { cache.delete(url); throw erro; });
      cache.set(url, entrada);
      return entrada.promessa;
    },
  };
}
