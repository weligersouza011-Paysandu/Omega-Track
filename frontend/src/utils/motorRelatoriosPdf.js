import JSZip from 'jszip';
import { gerarPdfParteDiariaNativo } from './pdfParteDiariaNativo.js';
import { criarCacheImagensPdf } from './imagensRelatorioPdf.js';

export function criarMotorRelatoriosPdf({ cacheImagens = criarCacheImagensPdf(), onProgresso = () => {} } = {}) {
  const zip = new JSZip();
  let concluidos = 0, total = 0, logo;
  async function preparar(arquivo) {
    const parte = arquivo.relatorio;
    const urls = [...new Set([
      ...(parte.fotos || []).map((foto) => foto.url),
      ...(parte.assinaturas || []).map((a) => a.assinatura_dado || a.assinatura_url).filter(Boolean),
    ])];
    logo ||= cacheImagens.obter('/logo/0.png').catch(() => cacheImagens.obter('/logo/01.png'));
    const [imagemLogo, midias] = await Promise.all([logo, Promise.all(urls.map((url) => cacheImagens.obter(url)))]);
    return { logo: imagemLogo, imagens: Object.fromEntries(urls.map((url, i) => [url, midias[i]])) };
  }
  return {
    async processarLote(arquivos, quantidadeTotal) {
      total = quantidadeTotal;
      // Só dois relatórios de mídia à frente: sobrepõe a espera de rede ao
      // desenho dos PDFs sem carregar as imagens de 400 relatórios de uma vez.
      const preparados = new Map();
      const adiantar = (i) => {
        if (i < arquivos.length) preparados.set(i, preparar(arquivos[i]).then((dados) => ({ dados }), (erro) => ({ erro })));
      };
      adiantar(0); adiantar(1);
      for (let i = 0; i < arquivos.length; i += 1) {
        const arquivo = arquivos[i];
        onProgresso({ etapa: 'gerando', concluidos, total, obra: arquivo.obra, tag: arquivo.relatorio.tag });
        try {
          const preparado = await preparados.get(i);
          preparados.delete(i); adiantar(i + 2);
          if (preparado.erro) throw preparado.erro;
          const pdf = gerarPdfParteDiariaNativo(arquivo.relatorio, preparado.dados);
          zip.file(arquivo.caminho, pdf);
          concluidos += 1;
          onProgresso({ etapa: 'gerando', concluidos, total, obra: arquivo.obra, tag: arquivo.relatorio.tag });
        } catch (erro) {
          throw new Error(`${arquivo.obra} • ${arquivo.relatorio.tag || 'Sem TAG'}: ${erro.message} Nenhum ZIP foi baixado.`);
        }
      }
    },
    async finalizar() {
      if (!concluidos || concluidos !== total) throw new Error('O lote não foi concluído. Nenhum ZIP foi baixado.');
      let anterior = -1;
      return zip.generateAsync({ type: 'arraybuffer', compression: 'STORE', streamFiles: true }, ({ percent }) => {
        const percentual = Math.round(percent);
        if (percentual !== anterior) onProgresso({ etapa: 'compactando', concluidos, total, percentual });
        anterior = percentual;
      });
    },
  };
}
