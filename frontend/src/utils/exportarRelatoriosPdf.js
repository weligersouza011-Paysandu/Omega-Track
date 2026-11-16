import FileSaver from 'file-saver';
import { processarRelatoriosEmLotes, verificarCancelamento } from './relatoriosPeriodo.js';

export async function exportarRelatoriosPdf(sessao, periodo, opcoes = {}) {
  verificarCancelamento(opcoes.signal);
  if (typeof Worker === 'undefined') throw new Error('Use um navegador atualizado para exportar os PDFs.');
  const worker = new Worker(new URL('../workers/relatoriosPdf.worker.js', import.meta.url), { type: 'module' });
  const controller = new AbortController();
  const pendentes = new Map();
  let sequencia = 0, erroFatal = null;
  const falhar = (erro) => {
    erroFatal = erro;
    pendentes.forEach(({ reject }) => reject(erro));
    pendentes.clear();
  };
  const cancelar = () => {
    controller.abort();
    falhar(new DOMException('Exportação cancelada.', 'AbortError'));
    worker.terminate();
  };
  opcoes.signal?.addEventListener('abort', cancelar, { once: true });
  worker.onmessage = ({ data }) => {
    if (data.tipo === 'progresso') {
      if (!controller.signal.aborted) opcoes.onProgresso?.(data.progresso);
      return;
    }
    const chamada = pendentes.get(data.id);
    if (!chamada) return;
    pendentes.delete(data.id);
    if (data.tipo === 'erro') chamada.reject(new Error(data.mensagem));
    else chamada.resolve(data.resultado);
  };
  worker.onerror = () => falhar(new Error('Falha no gerador de PDFs. Recarregue a página e tente novamente.'));
  worker.onmessageerror = () => falhar(new Error('Falha na comunicação com o gerador de PDFs.'));
  const enviar = (tipo, dados = {}) => new Promise((resolve, reject) => {
    if (erroFatal) { reject(erroFatal); return; }
    const id = ++sequencia;
    pendentes.set(id, { resolve, reject });
    try { worker.postMessage({ tipo, id, ...dados }); }
    catch (erro) { pendentes.delete(id); reject(erro); }
  });
  try {
    const pacote = await processarRelatoriosEmLotes(sessao, periodo, {
      signal: controller.signal, onProgresso: opcoes.onProgresso,
      processarLote: (arquivos, { total }) => enviar('lote', { arquivos, total }),
    });
    verificarCancelamento(controller.signal);
    const conteudo = await enviar('finalizar');
    verificarCancelamento(controller.signal);
    FileSaver.saveAs(new Blob([conteudo], { type: 'application/zip' }), pacote.nome);
    return { total: pacote.total, obras: pacote.obras };
  } finally {
    controller.abort();
    opcoes.signal?.removeEventListener('abort', cancelar);
    worker.terminate();
    pendentes.clear();
  }
}
