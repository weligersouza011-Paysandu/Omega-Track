import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { agruparPorCategoria, matizesDasObras, SEM_CATEGORIA } from '../src/utils/categoriasProgramacao.js';
import { criarProgramacaoPdf } from '../src/utils/exportarProgramacaoPdf.js';

const OBRA = '11111111-1111-4111-8111-111111111111';
const equipamentos = [
  { tag: 'JI450', modelo: 'Caminhão Munck', obraId: OBRA },
  { tag: 'TER-01', modelo: 'Caminhonete', is_terceiro: true, empresaTerceira: 'Transportes XYZ', obraId: null },
  { tag: 'JI10', modelo: 'Caminhonete', obraId: OBRA },
  { tag: 'JI9', modelo: 'Caminhonete', obraId: null },
  { tag: 'RET-1', modelo: 'Retroescavadeira', obraId: null },
  { tag: 'X-1', modelo: '', obraId: null },
  { tag: 'GD-1', modelo: 'Guindaste 30t', obraId: null },
];

test('blocos seguem a relevância operacional e "Sem categoria" fica por último', () => {
  const blocos = agruparPorCategoria(equipamentos);
  assert.deepEqual(blocos.map((b) => b.nome),
    ['Caminhonete', 'Caminhão Munck', 'Guindaste 30t', 'Retroescavadeira', SEM_CATEGORIA]);
  assert.deepEqual(blocos.map((b) => b.icone), ['leve', 'caminhao', 'guindaste', 'maquina', 'outro']);
});

test('dentro do bloco: frota própria antes de terceiros, TAG em ordem natural', () => {
  const [leves] = agruparPorCategoria(equipamentos);
  assert.deepEqual(leves.itens.map((e) => e.tag), ['JI9', 'JI10', 'TER-01']);
});

test('cores das obras são estáveis e bem separadas', () => {
  const obras = ['Usina Sul', 'Obra Norte', 'Frente Ferrovia', 'Pátio 2', 'Mina Leste']
    .map((nome, i) => ({ id: `id-${i}`, nome }));
  const matizes = matizesDasObras(obras);
  assert.deepEqual(matizesDasObras([...obras].reverse()), matizes);
  const valores = [...matizes.values()];
  for (let i = 0; i < valores.length; i += 1) {
    for (let j = i + 1; j < valores.length; j += 1) {
      const distancia = Math.min(Math.abs(valores[i] - valores[j]), 360 - Math.abs(valores[i] - valores[j]));
      assert.ok(distancia >= 30, `matizes ${valores[i]} e ${valores[j]} muito próximos`);
    }
  }
});

test('PDF agrupa por categoria e identifica terceiros', () => {
  const pdf = criarProgramacaoPdf({
    data: '2026-11-16',
    equipamentos,
    obras: [{ id: OBRA, nome: 'Obra Norte', numeroContrato: 'CT-1', ativo: true }],
  }, new Date('2026-11-16T12:00:00Z'));
  // jsPDF comprime as páginas (FlateDecode): descomprime cada stream para ler o texto.
  const bruto = Buffer.from(pdf.output('arraybuffer'));
  const textos = [];
  let inicio = bruto.indexOf('stream');
  while (inicio !== -1) {
    const dados = inicio + (bruto[inicio + 6] === 0x0d ? 8 : 7);
    const fim = bruto.indexOf('endstream', dados);
    try { textos.push(inflateSync(bruto.subarray(dados, fim)).toString('latin1')); } catch { /* stream não comprimido */ }
    inicio = bruto.indexOf('stream', fim + 9);
  }
  const conteudo = textos.join('\n');
  for (const trecho of ['CAMINHONETE', 'TERCEIRO', 'Transportes XYZ', 'RETROESCAVADEIRA']) {
    assert.ok(conteudo.includes(trecho), `PDF sem "${trecho}"`);
  }
  assert.ok(conteudo.indexOf('CAMINHONETE') < conteudo.indexOf('RETROESCAVADEIRA'), 'ordem das categorias');
});
