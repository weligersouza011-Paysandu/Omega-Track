import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import FileSaver from 'file-saver';
import RelatorioParteDiariaPreview from '../components/RelatorioParteDiariaPreview.jsx';
import { criarPacoteRelatorios, verificarCancelamento } from './relatoriosPeriodo.js';
import { gerarPdfRelatorio } from './gerarPdfRelatorio.js';

export async function exportarRelatoriosPdf(sessao, periodo, opcoes) {
  // Um relatório de cada vez limita o consumo de memória, mesmo em períodos
  // extensos. Fora da app-layout, o tema escuro não altera o relatório oficial.
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed', top: '0', left: '0', width: '794px',
    zIndex: '-1', pointerEvents: 'none',
  });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    const pacote = await criarPacoteRelatorios(sessao, periodo, {
      ...opcoes,
      gerarPdf: async (relatorio, { signal }) => {
        verificarCancelamento(signal);
        const ref = { current: null };
        flushSync(() => root.render(createElement(RelatorioParteDiariaPreview, {
          key: relatorio.id, relatorio, somenteConteudo: true, conteudoRef: ref,
        })));
        return gerarPdfRelatorio(ref.current, { signal });
      },
    });
    verificarCancelamento(opcoes?.signal);
    FileSaver.saveAs(new Blob([pacote.conteudo], { type: 'application/zip' }), pacote.nome);
    return { total: pacote.total, obras: pacote.obras };
  } finally {
    root.unmount();
    host.remove();
  }
}
