// ============================================================================
// Kit de implantacao de contrato novo + verificacao de integridade, contra
// PostgreSQL de verdade (PGlite) e com login real pela API.
// ============================================================================
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { iniciarAmbiente } from './ambiente.mjs';
import { semearContrato } from './dados.mjs';
import {
  planejarNovoContrato, aplicarNovoContrato, verificarIntegridade, contagemPorContrato, resumoLegado, gerarSenhaProvisoria, locacaoDoValorAntigo,
} from '../../src/services/implantacaoContrato.js';
import { verificarSenha } from '../../src/utils/senha.js';

let ambiente;
let p; // cliente sem trava (semente)
let ids251;
let base;
let servidor;

const PEDIDO = () => ({
  contrato: '010',
  administradores: [
    { nome: 'Gestora 010', matricula: 'G010', setor: 'GESTAO', funcao: 'Gestora' },
    { nome: 'Planejador 010', matricula: 'P010', setor: 'PLANEJADOR', senha: 'senha-do-planejador' },
  ],
  operacionais: [{ nome: 'Motorista 010', matricula: 'M010', funcao: 'Motorista' }],
  obras: [{ nome: 'Obra Nova 010', numero_contrato: '4800009999', planejador_matricula: 'P010' }],
});

before(async () => {
  ambiente = await iniciarAmbiente();
  p = ambiente.semente;
  ids251 = await semearContrato(p, '251');
  servidor = ambiente.app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
}, { timeout: 120000 });

after(async () => {
  await new Promise((r) => servidor?.close(r));
  await ambiente?.encerrar();
});

const post = async (caminho, corpo, token) => {
  const r = await fetch(`${base}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
const get = async (caminho, token) => {
  const r = await fetch(`${base}${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

test('pedido invalido e recusado com todos os motivos (e nada e gravado)', async () => {
  const ruim = {
    contrato: '10',
    administradores: [{ nome: 'Ana', matricula: 'AX 1', setor: 'COZINHA' }, { nome: 'Bia', matricula: 'AX 1', setor: 'TRANSPORTE', senha: '12' }],
    obras: [{ nome: '', planejador_matricula: 'NAOEXISTE' }, { nome: 'Obra', planejador_matricula: 'AX 1' }],
  };
  const { erros, plano } = await planejarNovoContrato(p, ruim);
  assert.equal(plano, null);
  const junto = erros.join(' | ');
  for (const trecho of ['Contrato inválido', 'GESTAO', 'inválida', 'Setor "COZINHA"', 'menos de 4', 'repetida', 'informe o nome', 'precisa estar na lista']) {
    assert.ok(junto.includes(trecho), `faltou o erro sobre "${trecho}": ${junto}`);
  }
  assert.equal(await p.usuario.count({ where: { contrato: '10' } }), 0);

  // Contrato que ja existe e matricula ja usada em outro contrato.
  const existente = await planejarNovoContrato(p, { ...PEDIDO(), contrato: '251' });
  assert.ok(existente.erros.some((e) => /já existe/.test(e)));
  const matriculaRepetida = await planejarNovoContrato(p, { ...PEDIDO(), administradores: [{ nome: 'X', matricula: 'NX251', setor: 'GESTAO' }] });
  assert.ok(matriculaRepetida.erros.some((e) => /já cadastrada/.test(e) && e.includes('NX251')));
});

test('simulacao nao grava; aplicar cria usuarios, senhas com hash e obras com planejador', async () => {
  const { erros, plano, avisos } = await planejarNovoContrato(p, PEDIDO());
  assert.deepEqual(erros, []);
  assert.ok(avisos.some((a) => /Locações/.test(a)));
  assert.equal(await p.usuario.count({ where: { contrato: '010' } }), 0, 'planejar nao grava');

  const r = await aplicarNovoContrato(p, plano);
  assert.deepEqual([r.usuarios, r.obras], [3, 1]);
  // So a Gestora recebeu senha gerada (o Planejador trouxe a propria); o banco guarda apenas o hash.
  assert.deepEqual(r.senhasGeradas.map((s) => s.matricula), ['G010']);
  const gestora = await p.usuario.findUnique({ where: { matricula: 'G010' } });
  assert.equal(gestora.contrato, '010');
  assert.equal(gestora.nivel, 'NORMAL', 'o kit nunca cria Master');
  assert.notEqual(gestora.senha_hash, r.senhasGeradas[0].senha);
  assert.ok(verificarSenha(r.senhasGeradas[0].senha, gestora.senha_hash));
  assert.ok(verificarSenha('senha-do-planejador', (await p.usuario.findUnique({ where: { matricula: 'P010' } })).senha_hash));
  const obra = await p.obra.findFirst({ where: { nome: 'Obra Nova 010' } });
  assert.deepEqual([obra.contrato, obra.planejador, obra.planejador_matricula], ['010', 'Planejador 010', 'P010']);
  assert.equal((await p.usuario.findUnique({ where: { matricula: 'M010' } })).tipo, 'OPERACIONAL');

  // Rodar de novo: o contrato ja existe, nada duplica.
  assert.ok((await planejarNovoContrato(p, PEDIDO())).erros.some((e) => /já existe/.test(e)));
});

test('a gestora do contrato novo entra pela API e enxerga so o contrato dela', async () => {
  const senha = (await p.usuario.findUnique({ where: { matricula: 'G010' } })).senha_hash && gerarSenhaProvisoria();
  assert.equal(senha.length, 10);
  // Senha conhecida para o login do teste.
  const { hashSenha } = await import('../../src/utils/senha.js');
  await p.usuario.update({ where: { matricula: 'G010' }, data: { senha_hash: hashSenha('minha-senha-teste') } });
  const login = await post('/login', { matricula: 'G010', senha: 'minha-senha-teste' });
  assert.equal(login.status, 200);
  const token = login.corpo.data.token;

  assert.deepEqual((await get('/contratos', token)).corpo, { data: ['010'], meu: '010', master: false });
  const obras = await get('/obras', token);
  assert.deepEqual(obras.corpo.data.map((o) => o.nome), ['Obra Nova 010']);
  assert.equal((await get('/mob-desmob', token)).corpo.data.length, 0, 'contrato novo comeca sem veiculos');
  assert.ok(!JSON.stringify((await get('/usuarios', token)).corpo).includes('X251'));
  assert.equal((await get(`/obras/${ids251.obra}`, token)).status, 404);

  // Ela cadastra o primeiro veiculo do contrato com locacao e ele nasce no 010.
  const veic = await post('/mob-desmob', { tag: 'N010A', placa: 'NNN0A10', modelo: 'Van', status: 'Mobilizado', data_mob: '2026-11-01', locacao: 'serra norte' }, token);
  assert.equal(veic.status, 201, JSON.stringify(veic.corpo));
  assert.deepEqual([veic.corpo.data.contrato, veic.corpo.data.locacao], ['010', 'Serra Norte']);
});

test('contagem por contrato mostra o contrato novo ao lado do antigo', async () => {
  const contagem = await contagemPorContrato(p);
  assert.equal(contagem['010'].Usuários, 3);
  assert.equal(contagem['010'].Obras, 1);
  assert.equal(contagem['251'].Veículos, 2);
});

test('verificacao: acusa erros reais e deixa passar o que esta consistente', async () => {
  // Dados do 251 do teste nao tem senha nos administradores: e um ERRO de verdade (nao conseguem entrar).
  const inicial = await verificarIntegridade(p);
  assert.ok(inicial.find((c) => /sem senha/.test(c.descricao) && !c.ok), 'administrador sem senha deveria ser acusado');
  await p.usuario.updateMany({ where: { tipo: 'ADMINISTRADOR', senha_hash: null }, data: { senha_hash: 'scrypt:aa:bb' } });

  const erros = (lista) => lista.filter((c) => !c.ok && c.gravidade === 'erro').map((c) => c.descricao);
  assert.deepEqual(erros(await verificarIntegridade(p)), [], 'sem problemas plantados nao pode haver erro');

  // Problemas plantados:
  const obra010 = await p.obra.findFirst({ where: { contrato: '010' } });
  await p.programacaoRecurso.create({ data: { tag: ids251.tag, obra_id: obra010.id, data: new Date('2026-01-02'), contrato: '251' } }); // obra de outro contrato
  await p.veiculoContratoHistorico.create({ data: { tag: ids251.tag, contrato: '999', vigente_desde: new Date('2026-01-01') } });      // vigencia aberta divergente
  await p.mobDesmob.create({ data: { tag: 'ORFAO7', placa: 'ORF7A77', status: 'Mobilizado', contrato: '777' } });                     // contrato sem administrador
  await p.obra.create({ data: { nome: 'Obra sem planejador valido', contrato: '251', planejador_matricula: 'NAOEXISTE' } });          // aviso
  const depois = await verificarIntegridade(p);
  const achados = erros(depois);
  assert.ok(achados.some((d) => /sem nenhum administrador/.test(d)), achados.join(' | '));
  assert.ok(achados.some((d) => /obra de contrato diferente/.test(d)));
  assert.ok(achados.some((d) => /vigência aberta/.test(d)));
  const contratoOrfao = depois.find((c) => /sem nenhum administrador/.test(c.descricao));
  assert.deepEqual(contratoOrfao.exemplos, ['777']);
  assert.ok(depois.find((c) => /planejador vinculado inexistente/.test(c.descricao)).quantidade >= 1);
});

test('resumo do legado: o que cada valor antigo virou em locacao', async () => {
  assert.deepEqual(await resumoLegado(p), { existe: true, linhas: [] }, 'banco criado do zero: backup vazio');
  await p.$executeRawUnsafe(`INSERT INTO contrato_legado_backup (tabela, chave, contrato_antigo) VALUES
    ('mob_desmob','A1','Eletromecânica'),('mob_desmob','A2','ELETROMECANICA'),('mob_desmob','A3','Serra Leste'),
    ('mob_desmob','A4','CT-251'),('mob_desmob','A5','Sondagem'),('mob_desmob','A6',NULL)`);
  const { linhas } = await resumoLegado(p);
  const por = Object.fromEntries(linhas.filter((l) => l.valor_antigo).map((l) => [l.valor_antigo, l.locacao]));
  assert.deepEqual(por, { 'Eletromecânica': 'Serra Norte', ELETROMECANICA: 'Serra Norte', 'Serra Leste': 'Serra Leste', 'CT-251': null, Sondagem: null });
  assert.equal(locacaoDoValorAntigo('serra norte'), 'Serra Norte');
});
