// ============================================================================
// TESTE DE VAZAMENTO ENTRE CONTRATOS — contra PostgreSQL de verdade (PGlite) com a
// pilha real (rotas + controllers + Prisma + trava de contrato). Dois contratos
// (251 e 999) com dados em TODOS os modulos; cada texto carrega um marcador
// (X251 / X999). Um usuario comum de um contrato NUNCA pode ver o marcador do outro,
// nem ler/alterar/apagar registro dele por ID.
// ============================================================================
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { iniciarAmbiente } from './ambiente.mjs';
import { semearTudo, DIA_ISO, MES_ISO } from './dados.mjs';

let ambiente;
let semente;
let ids;
let base;
let servidor;
let assinarSessao;
let executarComContexto;
let prismaComTrava;

before(async () => {
  ambiente = await iniciarAmbiente();
  semente = ambiente.semente;
  ids = await semearTudo(semente);
  ({ assinarSessao } = await import('../../src/middleware/sessao.js'));
  ({ executarComContexto } = await import('../../src/config/escopoDados.js'));
  ({ default: prismaComTrava } = await import('../../src/config/database.js'));
  servidor = ambiente.app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
}, { timeout: 120000 });

after(async () => {
  await new Promise((r) => servidor?.close(r));
  await ambiente?.encerrar();
});

async function token(usuarioId) {
  return assinarSessao(await semente.usuario.findUnique({ where: { id: usuarioId } }));
}
async function chamar(usuarioId, metodo, caminho, corpo) {
  const resp = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(usuarioId)}` },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resp.text();
  return { status: resp.status, texto };
}

const PERIODO = `dataInicio=${DIA_ISO}&dataFim=${DIA_ISO}`;
// [caminho, deve conter dados proprios?]
const rotasLeitura = (c, outro) => [
  ['/mob-desmob?limit=200', true], ['/mob-desmob/locacoes', true], [`/mob-desmob/tag/${ids[c].tag}`, true],
  ['/obras', true], ['/usuarios', true], ['/usuarios/resumo-contratos', false], ['/usuarios/logs', true],
  ['/veiculos-terceiros', true], [`/programacao-recursos?data=${DIA_ISO}`, true],
  [`/partes-diarias?data_inicio=${DIA_ISO}&data_fim=${DIA_ISO}`, true], [`/partes-diarias/${ids[c].parte}`, true],
  [`/partes-diarias/aderencia?inicio=${DIA_ISO}&fim=${DIA_ISO}`, false], ['/partes-diarias/pendencias', false],
  ['/documentacao-veiculos', true], ['/documentacao-veiculos/farol', false], ['/manutencao/projecao-frota', true],
  ['/parametros-preventiva', true], ['/categorias-desvio', false],
  [`/eficiencia?${PERIODO}`, true], [`/eficiencia/matriz?mes=${MES_ISO}`, true],
  ['/controle-ambiental/fumaca-preta', true],
  ['/abastecimentos?limite=100', true], ['/abastecimentos/meses', false],
  ['/ecogestao/residuos', true], ['/ecogestao/residuos/meses', false],
  ['/ecogestao/agua', true], ['/ecogestao/agua/meses', false],
  ['/ecogestao/atos', true], ['/ecogestao/produtos-quimicos', true],
  ['/telemetria?horas=72', true], ['/telemetria/resumo?horas=72', true], ['/telemetria/semanas', false],
  [`/telemetria/trajeto?veiculo=${ids[c].placa}&${PERIODO}`, true],
  [`/telemetria/trajeto?veiculo=${ids[outro].placa}&${PERIODO}`, false, 'vazio'],
  ['/telemetria/placas-nao-cadastradas', false], ['/telemetria/fadiga?horas=72', false], ['/telemetria/velocidade?horas=72', false],
  ['/telemetria/planos', true], [`/telemetria/motoristas/historico?motorista=${encodeURIComponent(`Mot X${outro}`)}`, false, 'vazio'],
  ['/contratos', false],
];

for (const [c, outro] of [['251', '999'], ['999', '251']]) {
  for (const perfil of ['normal', 'gestao']) {
    test(`leitura: usuario ${perfil} do contrato ${c} nao ve nada do contrato ${outro}`, async () => {
      let respondidas = 0;
      for (const [caminho, temProprio, modo] of rotasLeitura(c, outro)) {
        const r = await chamar(ids[c][perfil], 'GET', caminho);
        assert.ok(r.status < 500, `${caminho} -> ${r.status}: ${r.texto.slice(0, 200)}`);
        if (modo === 'vazio') {
          // A resposta repete o veiculo/condutor buscado (eco), entao o marcador aparece;
          // o que importa e que NAO traga nenhum evento do outro contrato.
          const corpo = JSON.parse(r.texto);
          const eventos = corpo.pontos ?? corpo.ocorrencias_fadiga ?? corpo.ocorrencias_velocidade ?? [];
          assert.equal(corpo.total ?? corpo.total_eventos ?? 0, 0, `VAZAMENTO em ${caminho}`);
          assert.equal(eventos.length, 0, `VAZAMENTO em ${caminho}`);
          assert.deepEqual(corpo.planos ?? [], [], `VAZAMENTO em ${caminho}`);
          continue;
        }
        assert.ok(!r.texto.includes(`X${outro}`), `VAZAMENTO em ${caminho}: apareceu dado do contrato ${outro}`);
        if (r.status === 200) {
          respondidas += 1;
          if (temProprio) assert.ok(r.texto.includes(`X${c}`), `${caminho} nao trouxe os dados do proprio contrato ${c}`);
        }
      }
      assert.ok(respondidas >= 30, `so ${respondidas} rotas responderam 200 (o teste precisa exercitar o sistema)`);
    });
  }
}

test('operacional so ve partes e frota do proprio contrato', async () => {
  for (const [c, outro] of [['251', '999'], ['999', '251']]) {
    for (const caminho of ['/partes-diarias?limit=100', '/mob-desmob?limit=200', `/partes-diarias/${ids[outro].parte}`, `/mob-desmob/tag/${ids[outro].tag}`]) {
      const r = await chamar(ids[c].operador, 'GET', caminho);
      assert.ok(r.status < 500, caminho);
      assert.ok(!r.texto.includes(`X${outro}`), `VAZAMENTO ao operacional em ${caminho}`);
    }
  }
});

test('por ID: registro de outro contrato responde 404 em todos os modulos', async () => {
  const o = ids['999'];
  const alvos = [
    `/mob-desmob/tag/${o.tag}`, `/mob-desmob/placa/${o.placa}`, `/mob-desmob/${o.tag}/status-manutencao`, `/mob-desmob/${o.tag}/historico-contrato`,
    `/obras/${o.obra}`, `/partes-diarias/${o.parte}`, `/partes-diarias/${o.parte}/logs`,
    `/partes-diarias/ultima-km?tag=${o.tag}`, `/partes-diarias/obra-programada?tag=${o.tag}&data=${DIA_ISO}`,
    `/documentacao-veiculos/${o.doc}`,
  ];
  for (const caminho of alvos) {
    const r = await chamar(ids['251'].gestao, 'GET', caminho);
    assert.equal(r.status, 404, `${caminho} -> ${r.status} ${r.texto.slice(0, 120)}`);
  }
});

test('escrita em registro de outro contrato e recusada e nada muda', async () => {
  const o = ids['999'];
  const admin = ids['251'].gestao;
  const tentativas = [
    ['PUT', `/obras/${o.obra}`, { nome: 'HACK' }], ['DELETE', `/obras/${o.obra}`],
    ['PUT', `/mob-desmob/${o.tag}`, { modelo: 'HACK' }], ['PATCH', `/mob-desmob/${o.tag}`, { combustivel: 'Etanol' }],
    ['POST', `/mob-desmob/${o.tag}/preventiva`, {}], ['PUT', `/mob-desmob/${o.tag}/desmobilizar`, { data_desmob: DIA_ISO }],
    ['PUT', `/usuarios/${o.normal}`, { nome: 'HACK' }], ['DELETE', `/usuarios/${o.normal}`],
    ['PUT', `/veiculos-terceiros/${o.terceiro}`, { tipo: 'HACK' }], ['DELETE', `/veiculos-terceiros/${o.terceiro}`],
    ['PUT', `/partes-diarias/${o.parte}`, { observacao_rapida: 'HACK' }],
    ['DELETE', `/documentacao-veiculos/${o.doc}`],
    ['PATCH', `/telemetria/${o.evento}/tratativa`, { status_tratativa: 'DESCARTADO', observacao: 'HACK' }],
    ['DELETE', `/telemetria/${o.evento}`], ['PATCH', `/telemetria/planos/${o.plano}`, { analise: 'HACK' }], ['DELETE', `/telemetria/planos/${o.plano}`],
    ['PUT', `/ecogestao/residuos/${o.residuo}`, { tipo_residuos: 'HACK' }], ['DELETE', `/ecogestao/residuos/${o.residuo}`],
    ['PUT', `/ecogestao/agua/${o.agua}`, { pontos_captacao: 'HACK' }], ['DELETE', `/ecogestao/agua/${o.agua}`],
    ['PUT', `/ecogestao/atos/${o.ato}`, { licenca: 'HACK' }], ['DELETE', `/ecogestao/atos/${o.ato}`],
    ['PUT', `/ecogestao/produtos-quimicos/${o.quimico}`, { nome_produto: 'HACK' }], ['DELETE', `/ecogestao/produtos-quimicos/${o.quimico}`],
  ];
  for (const [metodo, caminho, corpo] of tentativas) {
    const r = await chamar(admin, metodo, caminho, corpo);
    assert.ok([403, 404].includes(r.status), `${metodo} ${caminho} -> ${r.status} (esperado 403/404): ${r.texto.slice(0, 150)}`);
  }
  // Exclusoes em lote com IDs de outro contrato nao apagam nada.
  for (const [caminho, lista] of [
    ['/ecogestao/residuos/excluir-lote', [o.residuo]], ['/ecogestao/agua/excluir-lote', [o.agua]],
    ['/ecogestao/atos/excluir-lote', [o.ato]], ['/ecogestao/produtos-quimicos/excluir-lote', [o.quimico]], ['/telemetria/excluir-lote', [o.evento]],
  ]) {
    const r = await chamar(admin, 'POST', caminho, { ids: lista });
    assert.ok(r.status < 500, caminho);
  }
  // Criar em outro contrato e recusado.
  assert.equal((await chamar(admin, 'POST', '/obras', { nome: 'Invasora', contrato: '999' })).status, 403);
  assert.equal((await chamar(admin, 'POST', '/ecogestao/residuos', { data: DIA_ISO, tipo_residuos: 'X', destinacao: 'CMD', quantidade_kg_l: 1, contrato: '999' })).status, 403);

  // Tudo do contrato 999 continua intacto.
  const dep = await semente.obra.findUnique({ where: { id: o.obra } });
  assert.equal(dep.nome, 'Obra X999');
  assert.equal((await semente.mobDesmob.findUnique({ where: { tag: o.tag } })).modelo, 'Van X999');
  assert.equal((await semente.usuario.findUnique({ where: { id: o.normal } })).nome, 'Normal X999');
  for (const [modelo, id] of [['veiculoTerceiro', o.terceiro], ['parteDiaria', o.parte], ['documentacaoVeiculo', o.doc], ['eventoTelemetria', o.evento],
    ['planoAcaoTelemetria', o.plano], ['residuo', o.residuo], ['consumoAgua', o.agua], ['atoAutorizativo', o.ato], ['produtoQuimico', o.quimico]]) {
    assert.ok(await semente[modelo].findUnique({ where: { id } }), `${modelo} do contrato 999 foi apagado`);
  }
  assert.equal(await semente.obra.count({ where: { nome: 'Invasora' } }), 0);
});

test('Master: padrao = o proprio contrato; ?contrato=todos junta tudo; acessa qualquer registro', async () => {
  const proprio = await chamar(ids.master, 'GET', '/mob-desmob?limit=200');
  assert.ok(proprio.texto.includes('X251') && !proprio.texto.includes('X999'));
  const todos = await chamar(ids.master, 'GET', '/mob-desmob?limit=200&contrato=todos');
  assert.ok(todos.texto.includes('X251') && todos.texto.includes('X999'));
  const outro = await chamar(ids.master, 'GET', '/mob-desmob?limit=200&contrato=999');
  assert.ok(outro.texto.includes('X999') && !outro.texto.includes('X251'));
  assert.equal((await chamar(ids.master, 'GET', `/obras/${ids['999'].obra}`)).status, 200);
  const lista = JSON.parse((await chamar(ids.master, 'GET', '/contratos')).texto);
  assert.deepEqual(lista.data, ['251', '999']);
});

test('usuario comum nao consegue pedir outro contrato nem forjar o parametro interno', async () => {
  for (const caminho of ['/mob-desmob?contrato=999', '/mob-desmob?contrato=todos', '/obras?contrato=999', '/telemetria?horas=72&contrato=999&__contrato=999',
    '/ecogestao/residuos?contrato=todos', '/eficiencia?contrato=999&dataInicio=' + DIA_ISO + '&dataFim=' + DIA_ISO]) {
    const r = await chamar(ids['251'].normal, 'GET', caminho);
    assert.ok(r.status < 500, caminho);
    assert.ok(!r.texto.includes('X999'), `VAZAMENTO em ${caminho}`);
  }
});

// --- A trava na camada de dados protege MESMO quando o controller "esquece" o filtro -------------
test('trava de dados: consultas sem filtro de contrato so enxergam o contrato do usuario', async () => {
  const comoUsuario = (contrato, fn) => executarComContexto({ restrito: true, contrato }, fn);
  const p = prismaComTrava;

  // Leituras sem nenhum filtro.
  assert.deepEqual((await comoUsuario('251', () => p.mobDesmob.findMany())).map((v) => v.contrato), ['251', '251']);
  assert.equal(await comoUsuario('251', () => p.mobDesmob.count()), 2);
  assert.equal((await comoUsuario('251', () => p.mobDesmob.groupBy({ by: ['contrato'], _count: { _all: true } }))).length, 1);
  assert.equal((await comoUsuario('251', () => p.abastecimento.aggregate({ _sum: { litros: true } })))._sum.litros, 40);
  assert.equal(await comoUsuario('251', () => p.usuario.count({ where: { tipo: 'ADMINISTRADOR' } })), 4 /* 3 comuns + master */);
  // Unicos: outro contrato aparece como inexistente.
  assert.equal(await comoUsuario('251', () => p.mobDesmob.findUnique({ where: { tag: ids['999'].tag } })), null);
  assert.equal(await comoUsuario('251', () => p.obra.findFirst({ where: { id: ids['999'].obra } })), null);
  // Relacoes (modelos sem coluna propria de contrato).
  assert.equal(await comoUsuario('251', () => p.documentacaoVeiculo.count()), 1);
  assert.equal(await comoUsuario('251', () => p.manutencaoRecurso.count()), 1);
  assert.equal(await comoUsuario('251', () => p.parteDiariaLog.count()), 0);
  // Regra de preventiva global (contrato nulo) segue visivel; a de outro contrato nao.
  await semente.parametroPreventiva.create({ data: { categoria: 'GLOBAL X', km_limite_preventiva: 1, contrato: null } });
  const regras = await comoUsuario('251', () => p.parametroPreventiva.findMany());
  // (as migrations ja semeiam algumas regras globais; so nao pode aparecer regra do 999)
  assert.ok(regras.every((r) => r.contrato === null || r.contrato === '251'), 'regra de outro contrato visivel');
  assert.ok(regras.some((r) => r.contrato === '251') && regras.some((r) => r.categoria === 'GLOBAL X'));

  // Escritas.
  await assert.rejects(comoUsuario('251', () => p.obra.update({ where: { id: ids['999'].obra }, data: { nome: 'HACK' } })), /not found|No record|required/i);
  assert.equal((await comoUsuario('251', () => p.obra.updateMany({ data: { nome: 'HACK' }, where: { id: ids['999'].obra } }))).count, 0);
  assert.equal((await comoUsuario('251', () => p.residuo.deleteMany({}))).count, 1, 'deleteMany sem filtro so alcanca o proprio contrato');
  assert.ok(await semente.residuo.findUnique({ where: { id: ids['999'].residuo } }), 'residuo do 999 sobreviveu');
  await assert.rejects(comoUsuario('251', () => p.obra.create({ data: { nome: 'Invasora', contrato: '999' } })), /fora do contrato/);
  await assert.rejects(comoUsuario('251', () => p.obra.update({ where: { id: ids['251'].obra }, data: { contrato: '999' } })), /fora do contrato/);
  const criada = await comoUsuario('251', () => p.obra.create({ data: { nome: 'Sem contrato informado' } }));
  assert.equal(criada.contrato, '251', 'create sem contrato recebe o do usuario');
  // Sem contexto (scripts/jobs) e Master: sem restricao.
  assert.equal(await p.mobDesmob.count(), 4);
  assert.equal(await executarComContexto({ restrito: false }, () => p.mobDesmob.count()), 4);
  // Contrato do usuario ausente: fecha tudo.
  assert.equal(await comoUsuario('', () => p.mobDesmob.count()), 0);
});

test('o contexto da requisicao sobrevive a callbacks (multer) e o semEscopo e deliberado', async () => {
  const { asyncHandler } = await import('../../src/middleware/error.js');
  const { semEscopo, comContextoDaRequisicao } = await import('../../src/config/escopoDados.js');
  const req = { contextoDados: { restrito: true, contrato: '251' } };
  let contratoVisto;
  const manipulador = asyncHandler(async () => { contratoVisto = (await prismaComTrava.mobDesmob.findMany()).map((v) => v.contrato); });
  await manipulador(req, {}, () => {});
  assert.deepEqual(contratoVisto, ['251', '251']);

  let dentroDoCallback;
  await new Promise((resolver) => setTimeout(comContextoDaRequisicao(req, async () => {
    dentroDoCallback = (await prismaComTrava.mobDesmob.findMany()).length;
    resolver();
  }), 5));
  assert.equal(dentroDoCallback, 2);

  assert.equal(await semEscopo(() => prismaComTrava.mobDesmob.count()), 4);
});
