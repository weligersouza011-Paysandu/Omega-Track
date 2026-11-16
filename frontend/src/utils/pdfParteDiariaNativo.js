import { jsPDF } from 'jspdf';
import { montarModeloRelatorio, formatarDataHora } from './modeloRelatorioParteDiaria.js';

const X = 13, W = 184, TOPO = 13, FIM = 280;
const LINHA = 4.5, PADDING = 2, ALTURA_MIN = 7.5;
const COR = { texto: '#0f172a', borda: '#cbd5e1', titulo: '#f1f5f9', branco: '#ffffff' };
const textoLimpo = (valor) => String(valor ?? '').replace(/[\u2013\u2014\u2212]/g, '-')
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u00a0/g, ' ');
const valor = (v) => v === '' || v == null ? '-' : textoLimpo(v);

// O documento é desenhado em texto/vetores. Apenas fotos, logo e assinaturas
// são imagens; nenhuma página é renderizada em canvas ou convertida em PNG.
export function criarDocumentoParteDiaria(relatorio, { imagens = {}, logo = null } = {}) {
  const m = montarModeloRelatorio(relatorio);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  pdf.setProperties({ title: `Parte Diaria ${m.numero}`, author: 'Omega Track', subject: valor(m.obra) });
  pdf.setLineWidth(0.25);
  let y = TOPO;

  function fonte(tamanho = 9.5, negrito = false, cor = COR.texto) {
    pdf.setFont('helvetica', negrito ? 'bold' : 'normal');
    pdf.setFontSize(tamanho);
    pdf.setTextColor(cor);
  }
  function linhas(conteudo, largura, tamanho = 9.5, negrito = false) {
    fonte(tamanho, negrito);
    return pdf.splitTextToSize(valor(conteudo), Math.max(1, largura));
  }
  function escrever(conteudo, x, topo, { tamanho = 9.5, negrito = false, largura, alinhar = 'left', cor } = {}) {
    fonte(tamanho, negrito, cor);
    const lista = largura ? linhas(conteudo, largura, tamanho, negrito) : [valor(conteudo)];
    pdf.setTextColor(cor || COR.texto);
    pdf.text(lista, x, topo + tamanho * 0.3528, { align: alinhar, lineHeightFactor: LINHA / (tamanho * 0.3528) });
    return lista.length;
  }
  function caixa(x, topo, largura, altura, fundo = COR.branco) {
    pdf.setFillColor(fundo);
    pdf.setDrawColor(COR.borda);
    pdf.rect(x, topo, largura, altura, 'FD');
  }
  function novaPagina() {
    pdf.addPage();
    escrever(`Parte Diária ${m.dataFormatada} n° ${m.numero}`, X, TOPO, { tamanho: 8, negrito: true });
    pdf.setDrawColor(COR.borda);
    pdf.line(X, TOPO + 6, X + W, TOPO + 6);
    y = TOPO + 9;
  }
  function garantir(altura) {
    if (y + altura > FIM && y > TOPO + 10) novaPagina();
  }
  function titulo(nome) {
    caixa(X, y, W, ALTURA_MIN, COR.titulo);
    escrever(nome, X + PADDING, y + 1.7, { negrito: true });
    y += ALTURA_MIN;
  }
  function tabela(nome, larguras, cabecalhos, registros, { vazio = 'Nenhum registro lançado.', negritoPrimeira = false } = {}) {
    y += 2.5;
    const inicio = () => {
      garantir(ALTURA_MIN * (cabecalhos ? 3 : 2));
      titulo(nome);
      if (cabecalhos) desenharLinha(cabecalhos, true);
    };
    const desenharLinha = (celulas, cabecalho = false) => {
      const conteudos = celulas.map((celula, i) => linhas(celula, W * larguras[i] - PADDING * 2, cabecalho ? 8.8 : 9.5,
        cabecalho || (negritoPrimeira && i === 0)));
      let restantes = Math.max(...conteudos.map((lista) => lista.length));
      const alturaTotal = Math.max(ALTURA_MIN, restantes * LINHA + PADDING * 2);
      // Mantém a linha inteira se ela cabe em uma página. Textos maiores que
      // uma página são divididos por linhas, repetindo os títulos/colunas.
      if (!cabecalho && y + alturaTotal > FIM && alturaTotal < FIM - TOPO - 35) {
        novaPagina(); titulo(nome);
        if (cabecalhos) desenharLinha(cabecalhos, true);
      }
      let deslocamento = 0;
      while (restantes > 0) {
        let disponiveis = Math.floor((FIM - y - PADDING * 2) / LINHA);
        if (disponiveis < 1) {
          novaPagina(); titulo(nome);
          if (cabecalhos && !cabecalho) desenharLinha(cabecalhos, true);
          disponiveis = Math.floor((FIM - y - PADDING * 2) / LINHA);
        }
        const quantidade = Math.min(restantes, disponiveis);
        const altura = Math.max(ALTURA_MIN, quantidade * LINHA + PADDING * 2);
        let x = X;
        for (let i = 0; i < larguras.length; i += 1) {
          const largura = W * larguras[i];
          caixa(x, y, largura, altura, cabecalho ? COR.titulo : COR.branco);
          fonte(cabecalho ? 8.8 : 9.5, cabecalho || (negritoPrimeira && i === 0));
          const trecho = conteudos[i].slice(deslocamento, deslocamento + quantidade);
          if (trecho.length) pdf.text(trecho, x + PADDING, y + PADDING + 3.1, { lineHeightFactor: LINHA / ((cabecalho ? 8.8 : 9.5) * 0.3528) });
          x += largura;
        }
        y += altura;
        deslocamento += quantidade;
        restantes -= quantidade;
      }
    };
    inicio();
    if (!registros.length) {
      garantir(ALTURA_MIN);
      caixa(X, y, W, ALTURA_MIN);
      escrever(vazio, X + W / 2, y + 1.7, { tamanho: 8.8, alinhar: 'center' });
      y += ALTURA_MIN;
    } else registros.forEach((registro) => desenharLinha(registro));
  }
  function imagem(dados, x, topo, largura, altura, alias) {
    if (!dados?.dados?.length || !dados.largura || !dados.altura) throw new Error('Imagem do relatório indisponível.');
    const escala = Math.min(largura / dados.largura, altura / dados.altura);
    const w = dados.largura * escala, h = dados.altura * escala;
    pdf.addImage(dados.dados, dados.formato || 'JPEG', x + (largura - w) / 2, topo + (altura - h) / 2, w, h, alias, 'FAST');
  }
  function buscarImagem(url) {
    const dados = imagens instanceof Map ? imagens.get(url) : imagens[url];
    if (!dados) throw new Error('Uma foto ou assinatura não foi carregada.');
    return dados;
  }

  const larguraStatus = Math.min(62, Math.max(29, linhas(m.statusLabel, 60, 9, true)[0].length * 1.55 + 7));
  const tituloLinhas = linhas(`Parte Diária ${m.dataFormatada} n° ${m.numero}`, W - larguraStatus - 5, 9);
  escrever(tituloLinhas.join('\n'), X, y + 1, { tamanho: 9 });
  const coresStatus = {
    Aprovado: ['#dcfce7', '#166534'],
    'Revisado pelo Transporte': ['#fee2e2', '#991b1b'],
    'Finalizado pelo Operador': ['#fef3c7', '#92400e'],
    'Em Preenchimento': ['#f1f5f9', '#0f172a'],
  };
  const [fundoStatus, tintaStatus] = coresStatus[m.statusLabel];
  caixa(X + W - larguraStatus, y, larguraStatus, 7, fundoStatus);
  escrever(m.statusLabel, X + W - larguraStatus / 2, y + 1.6, { tamanho: 8.5, negrito: true, alinhar: 'center', cor: tintaStatus });
  y += Math.max(9, tituloLinhas.length * LINHA + 3);

  const metadata = [['Relatório nº', m.numero], ['Data', m.dataFormatada], ['Dia da semana', m.diaSemana],
    ['Status operacional', m.statusOp], ['Contrato', m.numero_contrato]];
  const esquerda = W * 0.54, direita = W - esquerda;
  const alturasMeta = metadata.map(([nome, conteudo]) => Math.max(ALTURA_MIN,
    Math.max(linhas(nome, direita / 2 - 4, 8.5, true).length, linhas(conteudo, direita / 2 - 4, 9).length) * LINHA + 4));
  const alturaMeta = alturasMeta.reduce((soma, altura) => soma + altura, 0);
  caixa(X, y, esquerda, alturaMeta);
  if (logo) imagem(logo, X + 8, y + 3, esquerda - 16, alturaMeta - 13, 'logo-omega');
  else escrever('OMEGA SERVICE', X + esquerda / 2, y + 9, { tamanho: 14, negrito: true, alinhar: 'center' });
  escrever('Parte Diária', X + esquerda / 2, y + alturaMeta - 8, { tamanho: 11, negrito: true, alinhar: 'center' });
  let metaY = y;
  metadata.forEach(([nome, conteudo], indice) => {
    const altura = alturasMeta[indice];
    caixa(X + esquerda, metaY, direita / 2, altura, COR.titulo);
    caixa(X + esquerda + direita / 2, metaY, direita / 2, altura);
    escrever(nome, X + esquerda + 2, metaY + 2, { tamanho: 8.5, negrito: true, largura: direita / 2 - 4 });
    escrever(conteudo, X + esquerda + direita / 2 + 2, metaY + 2, { tamanho: 9, largura: direita / 2 - 4 });
    metaY += altura;
  });
  y += alturaMeta;

  tabela('Obra / Local', [0.28, 0.72], null, [
    ['Obra', m.obra], ['Contratante', m.contratante], ['Responsável', m.responsavel], ['Planejador', m.planejador],
  ], { negritoPrimeira: true });

  y += 2.5; garantir(31); titulo('Horário de trabalho');
  const jornadaX = X + W * 0.68;
  [['Entrada / Saída', m.jornada], ['Intervalo', m.intervalo]].forEach(([nome, conteudo], indice) => {
    const topo = y + indice * 9;
    caixa(X, topo, W * 0.68 * 0.42, 9, COR.titulo);
    caixa(X + W * 0.68 * 0.42, topo, W * 0.68 * 0.58, 9);
    escrever(nome, X + 2, topo + 2, { tamanho: 9, negrito: true });
    escrever(conteudo, X + W * 0.68 * 0.42 + 2, topo + 2);
  });
  caixa(jornadaX, y, W * 0.32, 18);
  escrever('HORAS TRABALHADAS', jornadaX + W * 0.16, y + 2.5, { tamanho: 7.8, negrito: true, alinhar: 'center' });
  escrever(m.horas, jornadaX + W * 0.16, y + 7.5, { tamanho: 20, negrito: true, alinhar: 'center' });
  y += 18;

  tabela(`Mão de obra (${m.maoObra.length})`, [0.24, 0.46, 0.30], ['Matrícula', 'Nome', 'Função'],
    m.maoObra.map((pessoa) => [pessoa.matricula, `${valor(pessoa.nome)}${pessoa.observacao ? `\n${pessoa.observacao}` : ''}`, pessoa.funcao]),
    { vazio: 'Nenhum colaborador lançado.' });
  tabela(`Equipamentos (${m.equipamentos.length})`, [0.20, 0.60, 0.20], ['TAG', 'Descrição', 'Status'],
    m.equipamentos.map((e) => [e.tag_patrimonio, e.descricao, e.status]), { vazio: 'Nenhum veículo/equipamento lançado.' });
  tabela('Quilometragem', [0.5, 0.5], ['KM Inicial', 'KM Final'], [[m.km_inicial, m.km_final]]);
  tabela(`Atividades (${m.atividades.length})`, [0.82, 0.18], null,
    m.atividades.map((a) => [a.descricao, a.status]), { vazio: 'Nenhuma atividade lançada.' });
  tabela(`Ocorrências (${m.ocorrencias.length})`, [0.25, 0.75], null,
    m.ocorrencias.map((o) => [o.tipo, o.descricao]), { vazio: 'Nenhuma ocorrência registrada.' });

  if (m.fotos.length) {
    y += 2.5;
    for (let inicio = 0; inicio < m.fotos.length; inicio += 3) {
      const fotos = m.fotos.slice(inicio, inicio + 3);
      const legendas = fotos.map((foto) => foto.legenda ? linhas(foto.legenda, W / 3 - 6, 8) : []);
      const longa = legendas.some((lista) => lista.length > 12);
      const altura = 45 + (longa ? 0 : Math.max(...legendas.map((lista) => lista.length)) * LINHA);
      garantir(altura + ALTURA_MIN);
      titulo(`Fotos (${m.fotos.length})`);
      fotos.forEach((foto, i) => {
        const x = X + (W / 3) * i;
        caixa(x, y, W / 3, altura);
        imagem(buscarImagem(foto.url), x + 3, y + 2, W / 3 - 6, 39, foto.url);
        if (!longa && legendas[i].length) escrever(legendas[i].join('\n'), x + W / 6, y + 42, { tamanho: 8, alinhar: 'center' });
      });
      y += altura;
      if (longa) fotos.forEach((foto, i) => {
        if (foto.legenda) tabela(`Legenda da foto ${inicio + i + 1}`, [1], null, [[foto.legenda]]);
      });
    }
  }

  if (m.assinaturas.length) {
    y += 2.5;
    for (let inicio = 0; inicio < m.assinaturas.length; inicio += 3) {
      const assinaturas = m.assinaturas.slice(inicio, inicio + 3);
      const coluna = W / assinaturas.length;
      const alturas = assinaturas.map((a) => 37 + linhas(a.nome, coluna - 8, 9, true).length * LINHA
        + linhas(`${a.etapa}${a.matricula ? ` - ${a.matricula}` : ''}`, coluna - 8, 8).length * LINHA);
      const altura = Math.max(...alturas);
      garantir(altura + ALTURA_MIN);
      titulo(`Assinaturas (${m.assinaturas.length})`);
      caixa(X, y, W, altura);
      assinaturas.forEach((a, i) => {
        const x = X + coluna * i;
        const url = a.assinatura_dado || a.assinatura_url;
        if (url) imagem(buscarImagem(url), x + 4, y + 3, coluna - 8, 19, url);
        pdf.setDrawColor('#334155'); pdf.line(x + 4, y + 25, x + coluna - 4, y + 25);
        const nome = linhas(a.nome, coluna - 8, 9, true);
        escrever(nome.join('\n'), x + coluna / 2, y + 28, { tamanho: 9, negrito: true, alinhar: 'center' });
        const etapa = linhas(`${a.etapa}${a.matricula ? ` - ${a.matricula}` : ''}`, coluna - 8, 8);
        const etapaY = y + 29 + nome.length * LINHA;
        escrever(etapa.join('\n'), x + coluna / 2, etapaY, { tamanho: 8, alinhar: 'center' });
        if (a.assinado_em) escrever(formatarDataHora(a.assinado_em), x + coluna / 2, etapaY + etapa.length * LINHA + 1, { tamanho: 7.5, alinhar: 'center' });
      });
      y += altura;
    }
  }

  const paginas = pdf.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    pdf.setPage(pagina); pdf.setDrawColor(COR.borda); pdf.line(X, 284, X + W, 284);
    escrever('Omega Track - Omega Service Gestão de Transporte', X, 286, { tamanho: 7 });
    escrever(`Página ${pagina} de ${paginas}`, X + W, 286, { tamanho: 7, alinhar: 'right' });
  }
  return pdf;
}

export function gerarPdfParteDiariaNativo(relatorio, opcoes) {
  return criarDocumentoParteDiaria(relatorio, opcoes).output('arraybuffer');
}
