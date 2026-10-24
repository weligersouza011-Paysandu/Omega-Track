import { jsPDF } from 'jspdf';

const LARGURA = 297;
const ALTURA = 210;
const MARGEM = 16;
const LARGURA_CONTEUDO = LARGURA - MARGEM * 2;
const ALTURA_LINHA = 12;
const LIMITE_TABELA = ALTURA - 15;

const COR = {
  azulEscuro: [15, 29, 54],
  azul: [45, 91, 232],
  azulClaro: [229, 237, 255],
  verde: [0, 150, 113],
  verdeClaro: [225, 247, 239],
  amarelo: [182, 113, 17],
  amareloClaro: [255, 246, 225],
  laranja: [178, 82, 20],
  laranjaClaro: [255, 238, 220],
  texto: [29, 43, 67],
  secundario: [107, 122, 145],
  borda: [225, 231, 239],
  fundo: [247, 249, 252],
  branco: [255, 255, 255],
};

function preenchimento(pdf, cor) {
  pdf.setFillColor(...cor);
}

function tinta(pdf, cor) {
  pdf.setTextColor(...cor);
}

function texto(pdf, valor, x, y, { tamanho = 9, negrito = false, cor = COR.texto, alinhar } = {}) {
  pdf.setFont('helvetica', negrito ? 'bold' : 'normal');
  pdf.setFontSize(tamanho);
  tinta(pdf, cor);
  pdf.text(String(valor), x, y, alinhar ? { align: alinhar } : undefined);
}

function cortar(pdf, valor, largura) {
  const original = String(valor ?? '');
  if (pdf.getTextWidth(original) <= largura) return original;
  let resultado = original;
  while (resultado && pdf.getTextWidth(`${resultado}...`) > largura) {
    resultado = resultado.slice(0, -1);
  }
  return `${resultado.trimEnd()}...`;
}

function dataCurta(valor) {
  const [ano, mes, dia] = String(valor).split('-');
  return `${dia}/${mes}/${ano}`;
}

function dataCompleta(valor) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${valor}T12:00:00Z`));
}

function cabecalho(pdf, data, continuacao = false, logoDataUrl = null) {
  preenchimento(pdf, COR.azulEscuro);
  pdf.rect(0, 0, LARGURA, continuacao ? 27 : 38, 'F');
  if (logoDataUrl) {
    const caixa = { x: MARGEM, y: continuacao ? 5 : 8, largura: 51, altura: continuacao ? 17 : 22 };
    preenchimento(pdf, COR.branco);
    pdf.roundedRect(caixa.x, caixa.y, caixa.largura, caixa.altura, 2.5, 2.5, 'F');
    const imagem = pdf.getImageProperties(logoDataUrl);
    const escala = Math.min(47 / imagem.width, (caixa.altura - 3) / imagem.height);
    const largura = imagem.width * escala;
    const altura = imagem.height * escala;
    pdf.addImage(logoDataUrl, 'PNG',
      caixa.x + (caixa.largura - largura) / 2,
      caixa.y + (caixa.altura - altura) / 2,
      largura, altura);
  } else {
    preenchimento(pdf, COR.azul);
    pdf.roundedRect(MARGEM, continuacao ? 6 : 10, 17, 17, 3, 3, 'F');
    texto(pdf, 'OT', MARGEM + 8.5, continuacao ? 17 : 21, {
      tamanho: 12, negrito: true, cor: COR.branco, alinhar: 'center',
    });
  }
  const tituloX = logoDataUrl ? 74 : 39;
  texto(pdf, 'OMEGA TRACK', tituloX, continuacao ? 14 : 18, {
    tamanho: continuacao ? 14 : 16, negrito: true, cor: COR.branco,
  });
  texto(pdf, 'PROGRAMAÇÃO DE RECURSOS', tituloX, continuacao ? 20 : 26, {
    tamanho: 8, negrito: true, cor: [172, 194, 241],
  });
  preenchimento(pdf, [31, 48, 80]);
  pdf.roundedRect(222, continuacao ? 6 : 10, 59, 18, 3, 3, 'F');
  texto(pdf, dataCurta(data), 276, continuacao ? 14 : 18, {
    tamanho: 11, negrito: true, cor: COR.branco, alinhar: 'right',
  });
  texto(pdf, 'DIA PROGRAMADO', 276, continuacao ? 20 : 24, {
    tamanho: 6.5, negrito: true, cor: [172, 194, 241], alinhar: 'right',
  });
}

function cartaoResumo(pdf, x, y, largura, rotulo, valor, destaque, fundo) {
  preenchimento(pdf, COR.branco);
  pdf.setDrawColor(...COR.borda);
  pdf.roundedRect(x, y, largura, 23, 3, 3, 'FD');
  preenchimento(pdf, fundo);
  pdf.roundedRect(x + 3, y + 3, 5, 17, 1.5, 1.5, 'F');
  preenchimento(pdf, destaque);
  pdf.roundedRect(x + 3, y + 3, 5, 5, 1.5, 1.5, 'F');
  texto(pdf, rotulo.toUpperCase(), x + 12, y + 8, {
    tamanho: 7, negrito: true, cor: COR.secundario,
  });
  texto(pdf, valor, x + 12, y + 18, {
    tamanho: 17, negrito: true, cor: COR.azulEscuro,
  });
}

function gruposDaProgramacao(equipamentos, obrasPorId) {
  const contagem = new Map();
  for (const equipamento of equipamentos) {
    if (!equipamento.obraId || equipamento.manutencaoNoDia) continue;
    const obra = obrasPorId.get(equipamento.obraId);
    const nome = obra?.nome || 'Obra não encontrada';
    const atual = contagem.get(equipamento.obraId);
    contagem.set(equipamento.obraId, { nome, quantidade: (atual?.quantidade || 0) + 1 });
  }
  const gruposObras = [...contagem.values()].sort((a, b) =>
    b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR')
  );
  const emManutencao = equipamentos.filter((item) => item.manutencaoNoDia).length;
  const semProgramacao = equipamentos.filter((item) => !item.obraId && !item.manutencaoNoDia).length;
  const grupoLivre = semProgramacao > 0
    ? { nome: 'Sem programação', quantidade: semProgramacao, livre: true }
    : null;
  const grupoManutencao = emManutencao > 0
    ? { nome: 'Em manutenção', quantidade: emManutencao, manutencao: true }
    : null;
  const extras = [grupoLivre, grupoManutencao].filter(Boolean);
  if (gruposObras.length + extras.length <= 8) {
    return [...gruposObras, ...extras];
  }
  const limiteObras = 7 - extras.length;
  const visiveis = gruposObras.slice(0, limiteObras);
  visiveis.push({
    nome: 'Outras obras',
    quantidade: gruposObras.slice(limiteObras).reduce((soma, grupo) => soma + grupo.quantidade, 0),
  });
  visiveis.push(...extras);
  return visiveis;
}

function distribuicao(pdf, equipamentos, obrasPorId) {
  const grupos = gruposDaProgramacao(equipamentos, obrasPorId);
  const linhas = Math.max(1, Math.ceil(grupos.length / 2));
  const y = 77;
  const altura = 15 + linhas * 9;
  preenchimento(pdf, COR.fundo);
  pdf.setDrawColor(...COR.borda);
  pdf.roundedRect(MARGEM, y, LARGURA_CONTEUDO, altura, 3, 3, 'FD');
  texto(pdf, 'DISTRIBUIÇÃO POR OBRA', MARGEM + 5, y + 7, {
    tamanho: 9, negrito: true, cor: COR.azulEscuro,
  });
  texto(pdf, 'Participação no total de equipamentos', LARGURA - MARGEM - 5, y + 7, {
    tamanho: 7, cor: COR.secundario, alinhar: 'right',
  });

  if (grupos.length === 0) {
    texto(pdf, 'Nenhum equipamento mobilizado para esta data.', MARGEM + 5, y + 17, {
      tamanho: 8, cor: COR.secundario,
    });
  } else {
    const maior = Math.max(...grupos.map((grupo) => grupo.quantidade));
    grupos.forEach((grupo, indice) => {
      const x = MARGEM + 5 + (indice % 2) * 132;
      const linhaY = y + 14 + Math.floor(indice / 2) * 9;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      texto(pdf, cortar(pdf, grupo.nome, 94), x, linhaY, {
        tamanho: 7.5, negrito: true, cor: COR.texto,
      });
      const percentual = equipamentos.length ? Math.round(grupo.quantidade / equipamentos.length * 100) : 0;
      texto(pdf, `${grupo.quantidade}  ·  ${percentual}%`, x + 121, linhaY, {
        tamanho: 7.5, negrito: true, cor: grupo.manutencao ? COR.laranja : grupo.livre ? COR.amarelo : COR.azul,
        alinhar: 'right',
      });
      preenchimento(pdf, COR.borda);
      pdf.roundedRect(x, linhaY + 2, 121, 1.7, 0.8, 0.8, 'F');
      preenchimento(pdf, grupo.manutencao ? COR.laranja : grupo.livre ? COR.amarelo : COR.azul);
      pdf.roundedRect(x, linhaY + 2, Math.max(3, 121 * grupo.quantidade / maior), 1.7, 0.8, 0.8, 'F');
    });
  }
  return y + altura;
}

const COLUNAS = [
  { rotulo: 'EQUIPAMENTO', x: 16, largura: 65 },
  { rotulo: 'TAG', x: 81, largura: 32 },
  { rotulo: 'PLACA', x: 113, largura: 32 },
  { rotulo: 'OBRA / SITUAÇÃO', x: 145, largura: 105 },
  { rotulo: 'CONTRATO', x: 250, largura: 31 },
];

function tituloTabela(pdf, y, total, continuacao = false) {
  texto(pdf, continuacao ? 'RELAÇÃO DE EQUIPAMENTOS · CONTINUAÇÃO' : 'RELAÇÃO DE EQUIPAMENTOS', MARGEM, y, {
    tamanho: 9, negrito: true, cor: COR.azulEscuro,
  });
  texto(pdf, `${total} registro${total === 1 ? '' : 's'}`, LARGURA - MARGEM, y, {
    tamanho: 7.5, cor: COR.secundario, alinhar: 'right',
  });
}

function cabecalhoTabela(pdf, y) {
  preenchimento(pdf, COR.azulClaro);
  pdf.roundedRect(MARGEM, y, LARGURA_CONTEUDO, 8, 1.5, 1.5, 'F');
  COLUNAS.forEach((coluna) => texto(pdf, coluna.rotulo, coluna.x + 3, y + 5.2, {
    tamanho: 7, negrito: true, cor: COR.azulEscuro,
  }));
  return y + 8;
}

function linhaTabela(pdf, y, equipamento, obra, indice) {
  if (indice % 2 === 1) {
    preenchimento(pdf, COR.fundo);
    pdf.rect(MARGEM, y, LARGURA_CONTEUDO, ALTURA_LINHA, 'F');
  }
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  texto(pdf, cortar(pdf, equipamento.modelo || 'Equipamento', 59), 19, y + 4.7, {
    tamanho: 8, negrito: true,
  });
  texto(pdf, cortar(pdf, equipamento.tag || '—', 26), 84, y + 4.7, { tamanho: 8 });
  texto(pdf, cortar(pdf, equipamento.placa || '—', 26), 116, y + 4.7, { tamanho: 8 });
  const manutencao = equipamento.manutencaoNoDia;
  preenchimento(pdf, manutencao ? COR.laranja : obra ? COR.verde : COR.amarelo);
  pdf.circle(149, y + 3.6, 1.2, 'F');
  texto(pdf, cortar(pdf, manutencao
    ? `Manutenção ${manutencao.tipo === 'PREVENTIVA' ? 'Preventiva' : 'Corretiva'}`
    : obra?.nome || 'Sem programação', 93), 153, y + 4.7, {
    tamanho: 8, negrito: !!obra || !!manutencao, cor: manutencao ? COR.laranja : obra ? COR.texto : COR.amarelo,
  });
  texto(pdf, cortar(pdf, equipamento.contrato || '—', 25), 253, y + 4.7, { tamanho: 8 });
  if (manutencao) {
    texto(pdf, cortar(pdf, `Saída: ${dataCurta(manutencao.dataSaida)} · Prev.: ${dataCurta(manutencao.previsaoRetorno)}`, 126), 19, y + 9.5, {
      tamanho: 7, cor: COR.laranja,
    });
    texto(pdf, cortar(pdf, `Serviço: ${manutencao.descricao}`, 126), 151, y + 9.5, {
      tamanho: 7, cor: COR.secundario,
    });
  } else {
    const operador = equipamento.operadorNome || equipamento.operadorMatricula || 'Não definido';
    const supervisor = equipamento.supervisorNome || equipamento.supervisorMatricula || 'Não definido';
    const operadorMatricula = equipamento.operadorNome && equipamento.operadorMatricula
      ? ` · ${equipamento.operadorMatricula}` : '';
    const supervisorMatricula = equipamento.supervisorNome && equipamento.supervisorMatricula
      ? ` · ${equipamento.supervisorMatricula}` : '';
    texto(pdf, cortar(pdf, `Operador: ${operador}${operadorMatricula}`, 126), 19, y + 9.5, {
      tamanho: 7, cor: COR.secundario,
    });
    texto(pdf, cortar(pdf, `Supervisor: ${supervisor}${supervisorMatricula}`, 126), 151, y + 9.5, {
      tamanho: 7, cor: COR.secundario,
    });
  }
  pdf.setDrawColor(...COR.borda);
  pdf.setLineWidth(0.15);
  pdf.line(MARGEM, y + ALTURA_LINHA, LARGURA - MARGEM, y + ALTURA_LINHA);
}

function rodapes(pdf, emitidoEm) {
  const total = pdf.getNumberOfPages();
  for (let pagina = 1; pagina <= total; pagina += 1) {
    pdf.setPage(pagina);
    pdf.setDrawColor(...COR.borda);
    pdf.setLineWidth(0.2);
    pdf.line(MARGEM, ALTURA - 11, LARGURA - MARGEM, ALTURA - 11);
    texto(pdf, `Omega Track  ·  Emitido em ${emitidoEm}`, MARGEM, ALTURA - 6, {
      tamanho: 7, cor: COR.secundario,
    });
    texto(pdf, `Página ${pagina} de ${total}`, LARGURA - MARGEM, ALTURA - 6, {
      tamanho: 7, negrito: true, cor: COR.secundario, alinhar: 'right',
    });
  }
}

export function criarProgramacaoPdf(dados, agora = new Date(), logoDataUrl = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados?.data || '') || !Array.isArray(dados?.equipamentos)) {
    throw new Error('Os dados da programação estão incompletos para gerar o PDF.');
  }
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({
    title: `Programação de Recursos - ${dataCurta(dados.data)}`,
    subject: 'Alocação diária de equipamentos, obras, operadores e supervisores',
    author: 'Omega Track',
    creator: 'Omega Track',
  });
  const equipamentos = dados.equipamentos;
  const obrasPorId = new Map((dados.obras || []).map((obra) => [obra.id, obra]));
  const programados = equipamentos.filter((item) => item.obraId && !item.manutencaoNoDia).length;
  const emManutencao = equipamentos.filter((item) => item.manutencaoNoDia).length;
  const livres = equipamentos.length - programados - emManutencao;

  cabecalho(pdf, dados.data, false, logoDataUrl);
  texto(pdf, dataCompleta(dados.data), MARGEM, 43, { tamanho: 8.5, cor: COR.secundario });
  const larguraCartao = (LARGURA_CONTEUDO - 18) / 4;
  [
    ['Equipamentos', equipamentos.length, COR.azul, COR.azulClaro],
    ['Programados', programados, COR.verde, COR.verdeClaro],
    ['Sem programação', livres, COR.amarelo, COR.amareloClaro],
    ['Em manutenção', emManutencao, COR.laranja, COR.laranjaClaro],
  ].forEach(([rotulo, valor, destaque, fundo], indice) =>
    cartaoResumo(pdf, MARGEM + indice * (larguraCartao + 6), 48, larguraCartao, rotulo, valor, destaque, fundo)
  );

  const fimDistribuicao = distribuicao(pdf, equipamentos, obrasPorId);
  tituloTabela(pdf, fimDistribuicao + 8, equipamentos.length);
  let y = cabecalhoTabela(pdf, fimDistribuicao + 12);
  equipamentos.forEach((equipamento, indice) => {
    if (y + ALTURA_LINHA > LIMITE_TABELA) {
      pdf.addPage();
      cabecalho(pdf, dados.data, true, logoDataUrl);
      tituloTabela(pdf, 33, equipamentos.length, true);
      y = cabecalhoTabela(pdf, 37);
    }
    linhaTabela(pdf, y, equipamento, obrasPorId.get(equipamento.obraId), indice);
    y += ALTURA_LINHA;
  });
  if (equipamentos.length === 0) {
    texto(pdf, 'Nenhum equipamento mobilizado para esta data.', MARGEM + 3, y + 7, {
      tamanho: 9, cor: COR.secundario,
    });
  }

  const emitidoEm = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(agora);
  rodapes(pdf, emitidoEm);
  return pdf;
}

let promessaLogoOmega;

function carregarLogoOmega() {
  if (!promessaLogoOmega) {
    promessaLogoOmega = fetch('/logo/omega-horizontal.png')
      .then((resposta) => {
        if (!resposta.ok) throw new Error('Não foi possível carregar o logo da Omega para o PDF.');
        return resposta.blob();
      })
      .then((arquivo) => new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(leitor.result);
        leitor.onerror = () => reject(new Error('Não foi possível ler o logo da Omega para o PDF.'));
        leitor.readAsDataURL(arquivo);
      }))
      .catch((erro) => {
        promessaLogoOmega = null;
        throw erro;
      });
  }
  return promessaLogoOmega;
}

export async function exportarProgramacaoPdf(dados) {
  const logoDataUrl = await carregarLogoOmega();
  const pdf = criarProgramacaoPdf(dados, new Date(), logoDataUrl);
  pdf.save(`OmegaTrack_Programacao_${dados.data}.pdf`);
}
