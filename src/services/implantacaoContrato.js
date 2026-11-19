// ============================================================================
// Implantacao de um contrato novo e verificacao de integridade multi-contrato.
// Usado pelos scripts `npm run contrato:novo` e `npm run contrato:verificar`
// (rodam com acesso direto ao banco, fora das rotas, sem a trava de requisicao).
// ============================================================================
import { randomBytes } from 'node:crypto';
import { hashSenha } from '../utils/senha.js';
import { contratoValido, MENSAGEM_CONTRATO } from '../utils/contrato.js';

const SETORES_ADMIN = ['GESTAO', 'PLANEJADOR', 'TRANSPORTE', 'MEIO_AMBIENTE'];
const ALFABETO_SENHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // sem 0/O/1/l/I

function texto(valor) {
  const t = String(valor ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

/** Senha provisoria legivel (10 caracteres, sem simbolos ambiguos). */
export function gerarSenhaProvisoria(tamanho = 10) {
  const bytes = randomBytes(tamanho);
  return [...bytes].map((b) => ALFABETO_SENHA[b % ALFABETO_SENHA.length]).join('');
}

/**
 * Valida o pedido de um contrato novo contra o banco e devolve o plano (nada e gravado).
 * @returns {{ erros: string[], avisos: string[], plano: object|null }}
 */
export async function planejarNovoContrato(prisma, pedido = {}) {
  const erros = [];
  const avisos = [];
  const contrato = texto(pedido.contrato);
  if (!contratoValido(contrato ?? '')) erros.push(`Contrato inválido. ${MENSAGEM_CONTRATO}`);

  const administradores = (pedido.administradores ?? []).map((a) => ({
    nome: texto(a.nome), matricula: texto(a.matricula), funcao: texto(a.funcao),
    setor: String(a.setor || 'GESTAO').trim().toUpperCase(), senha: texto(a.senha),
  }));
  const operacionais = (pedido.operacionais ?? []).map((o) => ({ nome: texto(o.nome), matricula: texto(o.matricula), funcao: texto(o.funcao) }));
  const obras = (pedido.obras ?? []).map((o) => ({
    nome: texto(o.nome), numero_contrato: texto(o.numero_contrato), contratante: texto(o.contratante) ?? 'Vale',
    gestao: texto(o.gestao), planejador_matricula: texto(o.planejador_matricula),
  }));

  if (!administradores.some((a) => a.setor === 'GESTAO')) {
    erros.push('Informe ao menos um administrador do setor GESTAO (ele cadastra os demais usuários do contrato).');
  }
  const pessoas = [...administradores.map((a) => ({ ...a, tipo: 'administrador' })), ...operacionais.map((o) => ({ ...o, tipo: 'operacional' }))];
  pessoas.forEach((p, i) => {
    if (!p.nome) erros.push(`Usuário ${i + 1}: informe o nome.`);
    if (!p.matricula) erros.push(`Usuário ${p.nome ?? i + 1}: informe a matrícula.`);
    else if (/\s/.test(p.matricula) || p.matricula.length > 50) erros.push(`Matrícula "${p.matricula}" inválida (sem espaços, até 50 caracteres).`);
    if (p.tipo === 'administrador' && !SETORES_ADMIN.includes(p.setor)) erros.push(`Setor "${p.setor}" inválido para ${p.nome}. Use: ${SETORES_ADMIN.join(', ')}.`);
    if (p.senha && p.senha.length < 4) erros.push(`Senha de ${p.nome} com menos de 4 caracteres.`);
  });
  const repetidas = pessoas.map((p) => p.matricula).filter((m, i, todas) => m && todas.indexOf(m) !== i);
  if (repetidas.length) erros.push(`Matrícula repetida no pedido: ${[...new Set(repetidas)].join(', ')}.`);
  obras.forEach((o, i) => { if (!o.nome) erros.push(`Obra ${i + 1}: informe o nome.`); });
  obras.filter((o) => o.planejador_matricula).forEach((o) => {
    const planejador = administradores.find((a) => a.matricula === o.planejador_matricula);
    if (!planejador) erros.push(`Obra "${o.nome}": o planejador ${o.planejador_matricula} precisa estar na lista de administradores do pedido.`);
    else if (planejador.setor !== 'PLANEJADOR') erros.push(`Obra "${o.nome}": ${planejador.nome} não é do setor PLANEJADOR.`);
  });

  if (contratoValido(contrato ?? '')) {
    const [usuarios, veiculos, obrasExistentes, terceiros] = await Promise.all([
      prisma.usuario.count({ where: { contrato } }), prisma.mobDesmob.count({ where: { contrato } }),
      prisma.obra.count({ where: { contrato } }), prisma.veiculoTerceiro.count({ where: { contrato } }),
    ]);
    if (usuarios + veiculos + obrasExistentes + terceiros > 0) {
      erros.push(`O contrato ${contrato} já existe (${usuarios} usuário(s), ${veiculos} veículo(s), ${obrasExistentes} obra(s)). Este kit só implanta contrato novo.`);
    }
  }
  const matriculas = pessoas.map((p) => p.matricula).filter(Boolean);
  if (matriculas.length) {
    const existentes = await prisma.usuario.findMany({ where: { matricula: { in: matriculas } }, select: { matricula: true } });
    if (existentes.length) erros.push(`Matrícula já cadastrada (a matrícula é única em todos os contratos): ${existentes.map((e) => e.matricula).join(', ')}.`);
  }
  if (!obras.length) avisos.push('Nenhuma obra no pedido: cadastre-as depois na tela de Obras (o contrato será a do usuário).');
  if (!administradores.some((a) => a.setor === 'PLANEJADOR')) avisos.push('Nenhum usuário PLANEJADOR: as obras ficarão sem planejador vinculado até cadastrar um.');
  avisos.push('Locações (ex.: Serra Norte) surgem do cadastro dos veículos: informe a locação ao cadastrar o primeiro veículo do contrato.');

  if (erros.length) return { erros, avisos, plano: null };
  return { erros, avisos, plano: { contrato, administradores, operacionais, obras } };
}

/**
 * Grava o plano numa transacao. Administradores sem senha recebem uma provisoria
 * (devolvida UMA vez em `senhasGeradas`; o banco guarda so o hash).
 */
export async function aplicarNovoContrato(prisma, plano) {
  const senhasGeradas = [];
  await prisma.$transaction(async (tx) => {
    for (const a of plano.administradores) {
      const senha = a.senha ?? gerarSenhaProvisoria();
      if (!a.senha) senhasGeradas.push({ nome: a.nome, matricula: a.matricula, senha });
      await tx.usuario.create({
        data: {
          nome: a.nome, matricula: a.matricula, funcao: a.funcao, contrato: plano.contrato,
          tipo: 'ADMINISTRADOR', setor: a.setor, nivel: 'NORMAL', senha_hash: hashSenha(senha),
        },
      });
    }
    for (const o of plano.operacionais) {
      await tx.usuario.create({ data: { nome: o.nome, matricula: o.matricula, funcao: o.funcao, contrato: plano.contrato, tipo: 'OPERACIONAL' } });
    }
    for (const o of plano.obras) {
      const planejador = plano.administradores.find((a) => a.matricula === o.planejador_matricula);
      await tx.obra.create({
        data: {
          nome: o.nome, contrato: plano.contrato, numero_contrato: o.numero_contrato, contratante: o.contratante, gestao: o.gestao,
          planejador: planejador?.nome ?? null, planejador_matricula: planejador?.matricula ?? null,
        },
      });
    }
  });
  return {
    contrato: plano.contrato,
    usuarios: plano.administradores.length + plano.operacionais.length,
    obras: plano.obras.length,
    senhasGeradas,
  };
}

// ----------------------------------------------------------------------------
// Verificacao de integridade
// ----------------------------------------------------------------------------
const TABELAS_CONTAGEM = [
  ['usuarios', 'Usuários'], ['mob_desmob', 'Veículos'], ['veiculos_terceiros', 'Terceiros'], ['obras', 'Obras'],
  ['partes_diarias', 'Partes diárias'], ['programacao_recursos', 'Programação'], ['eventos_telemetria', 'Telemetria'],
  ['abastecimentos', 'Abastecimentos'], ['residuos', 'Resíduos'], ['consumo_agua', 'Água'],
  ['atos_autorizativos', 'Atos autorizativos'], ['produtos_quimicos', 'Produtos químicos'],
];

/** Quantos registros cada contrato tem em cada tabela. */
export async function contagemPorContrato(prisma) {
  const resultado = {};
  for (const [tabela, rotulo] of TABELAS_CONTAGEM) {
    // Nome da tabela vem da lista fixa acima (nunca de entrada externa).
    const linhas = await prisma.$queryRawUnsafe(`SELECT contrato, count(*)::int AS n FROM "${tabela}" GROUP BY contrato ORDER BY contrato`);
    for (const l of linhas) {
      resultado[l.contrato] ??= {};
      resultado[l.contrato][rotulo] = l.n;
    }
  }
  return resultado;
}

const mapa = (linhas) => linhas.map((l) => Object.values(l).join(' | ')).slice(0, 10);

/** Verificacoes (somente leitura). `gravidade`: erro = corrigir antes de operar; aviso = conferir. */
export async function verificarIntegridade(prisma) {
  const q = (sql) => prisma.$queryRawUnsafe(sql);
  const checagens = [
    ['erro', 'Contrato sem nenhum administrador (ninguém consegue cadastrar usuários)',
      q(`SELECT c.contrato FROM (SELECT contrato FROM usuarios UNION SELECT contrato FROM mob_desmob UNION SELECT contrato FROM obras) c
          WHERE NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.contrato = c.contrato AND u.tipo = 'ADMINISTRADOR') ORDER BY 1`)],
    ['erro', 'Administrador sem senha cadastrada (não consegue entrar)',
      q(`SELECT matricula, nome, contrato FROM usuarios WHERE tipo = 'ADMINISTRADOR' AND (senha_hash IS NULL OR senha_hash = '') ORDER BY 1`)],
    ['erro', 'Programação com obra de contrato diferente do equipamento',
      q(`SELECT p.tag, p.data::text, p.contrato AS contrato_equip, o.contrato AS contrato_obra FROM programacao_recursos p
          JOIN obras o ON o.id = p.obra_id WHERE o.contrato <> p.contrato ORDER BY p.data DESC`)],
    ['erro', 'Programação com contrato diferente do veículo',
      q(`SELECT p.tag, p.data::text, p.contrato AS contrato_prog, m.contrato AS contrato_veiculo FROM programacao_recursos p
          JOIN mob_desmob m ON m.tag = p.tag WHERE m.contrato <> p.contrato ORDER BY p.data DESC`)],
    ['erro', 'Contrato do veículo diferente da vigência aberta no histórico',
      q(`SELECT m.tag, m.contrato AS contrato_veiculo, h.contrato AS contrato_historico FROM mob_desmob m
          JOIN veiculo_contrato_historico h ON h.tag = m.tag AND h.vigente_ate IS NULL WHERE h.contrato <> m.contrato`)],
    ['aviso', 'Veículo sem registro no histórico de contrato (a troca de contrato recria a base)',
      q(`SELECT tag, contrato FROM mob_desmob m WHERE NOT EXISTS (SELECT 1 FROM veiculo_contrato_historico h WHERE h.tag = m.tag) ORDER BY 1`)],
    ['aviso', 'Veículo sem locação em contrato que usa locações',
      q(`SELECT tag, contrato FROM mob_desmob m WHERE locacao IS NULL AND deletado_em IS NULL
          AND EXISTS (SELECT 1 FROM mob_desmob x WHERE x.contrato = m.contrato AND x.locacao IS NOT NULL) ORDER BY 1`)],
    ['aviso', 'Obra com planejador vinculado inexistente ou de outro contrato',
      q(`SELECT o.nome, o.contrato, o.planejador_matricula FROM obras o WHERE o.planejador_matricula IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.matricula = o.planejador_matricula AND u.contrato = o.contrato) ORDER BY 1`)],
    ['aviso', 'Parte diária ligada a obra de outro contrato (esperado só depois de transferir veículo com data retroativa)',
      q(`SELECT p.numero_relatorio, p.tag, p.data::text, p.contrato AS contrato_parte, o.contrato AS contrato_obra FROM partes_diarias p
          JOIN obras o ON o.id = p.obra_id WHERE o.contrato <> p.contrato ORDER BY p.data DESC`)],
    ['aviso', 'Usuário operacional com matrícula provisória (PROV-...): conferir a matrícula real',
      q(`SELECT matricula, nome, contrato FROM usuarios WHERE matricula LIKE 'PROV-%' ORDER BY 1`)],
  ];
  const saida = [];
  for (const [gravidade, descricao, consulta] of checagens) {
    const linhas = await consulta;
    saida.push({ gravidade, descricao, ok: linhas.length === 0, quantidade: linhas.length, exemplos: mapa(linhas) });
  }
  return saida;
}

const NORTE = ['ELETROMEC', 'NORTE'];
const LESTE = ['LESTE'];
const semAcento = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** O que a migration 0042 faz com cada valor antigo guardado em contrato_legado_backup. */
export function locacaoDoValorAntigo(valor) {
  const v = semAcento(valor);
  if (NORTE.some((p) => v.includes(p))) return 'Serra Norte';
  if (LESTE.some((p) => v.includes(p))) return 'Serra Leste';
  return null;
}

/** Valores antigos de "contrato" (anteriores a padronizacao) e para qual locacao cada um foi. */
export async function resumoLegado(prisma) {
  const existe = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.contrato_legado_backup') IS NOT NULL AS existe`);
  if (!existe[0]?.existe) return { existe: false, linhas: [] };
  const linhas = await prisma.$queryRawUnsafe(
    `SELECT tabela, contrato_antigo, count(*)::int AS n FROM contrato_legado_backup GROUP BY 1, 2 ORDER BY 1, 3 DESC`,
  );
  return {
    existe: true,
    linhas: linhas.map((l) => ({ tabela: l.tabela, valor_antigo: l.contrato_antigo, quantidade: l.n, locacao: locacaoDoValorAntigo(l.contrato_antigo) })),
  };
}
