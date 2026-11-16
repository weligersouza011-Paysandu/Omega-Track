import { verificarCancelamento } from './relatoriosPeriodo.js';

// Aguarda fotos, logo e assinaturas. Uma imagem indisponível interrompe o
// lote para não entregar um relatório oficial sem suas evidências.
async function aguardarImagens(elemento, signal) {
  await Promise.all([...elemento.querySelectorAll('img')].map((imagem) => new Promise((resolve, reject) => {
    let temporizador;
    const terminar = (erro) => {
      clearTimeout(temporizador);
      imagem.removeEventListener('load', carregou);
      imagem.removeEventListener('error', falhou);
      signal?.removeEventListener('abort', cancelou);
      if (erro) reject(erro); else resolve();
    };
    const carregou = () => terminar();
    const falhou = () => queueMicrotask(() => {
      // O logo possui fallback: quando ele troca de src, aguarda a nova carga.
      if (imagem.complete && !imagem.naturalWidth) {
        terminar(new Error(`Não foi possível carregar a imagem: ${imagem.alt || 'foto/assinatura'}.`));
      }
    });
    const cancelou = () => terminar(new DOMException('Exportação cancelada.', 'AbortError'));
    imagem.addEventListener('load', carregou);
    imagem.addEventListener('error', falhou);
    signal?.addEventListener('abort', cancelou, { once: true });
    temporizador = setTimeout(() => terminar(new Error('Uma foto ou assinatura demorou demais para carregar. Tente novamente.')), 20000);
    if (signal?.aborted) cancelou();
    else if (imagem.complete) {
      if (imagem.naturalWidth) carregou(); else falhou();
    }
  })));
}

// Opções únicas para o PDF individual e os PDFs do lote.
export async function gerarPdfRelatorio(elemento, { nomeArquivo, signal } = {}) {
  verificarCancelamento(signal);
  await aguardarImagens(elemento, signal);
  await document.fonts?.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  verificarCancelamento(signal);
  const { default: html2pdf } = await import('html2pdf.js');
  const worker = html2pdf().set({
    margin: [8, 8, 8, 8],
    filename: nomeArquivo,
    image: { type: 'png' },
    html2canvas: {
      scale: 3, useCORS: true, scrollY: 0, scrollX: 0, windowWidth: 1200,
      dpi: 300, letterRendering: true, logging: false,
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  }).from(elemento);
  try {
    // O lote mantém os bytes em memória e faz somente um download ao terminar.
    const pdf = await worker.outputPdf('arraybuffer');
    verificarCancelamento(signal);
    if (nomeArquivo) await worker.save();
    return pdf;
  } finally {
    worker.prop?.overlay?.remove();
  }
}
