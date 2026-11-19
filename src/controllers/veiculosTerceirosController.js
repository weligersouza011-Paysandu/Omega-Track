// ============================================================================
// Veiculos Terceiros — cadastro simples, usado SOMENTE na Programacao de Recursos.
// Nao participa de Parte Diaria, telemetria, documentacao nem KPIs da frota
// propria (tabela isolada `veiculos_terceiros`). Exclusao e direta (hard delete),
// levando junto as alocacoes da programacao (cascata).
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { validarUrlMidia } from '../config/cloudinary.js';
import { registrarLogAtividade } from '../services/auditService.js';
import { contratoParaGravar, filtroContrato } from '../middleware/escopo.js';
import { tagSemEspaco, MENSAGEM_TAG } from '../utils/contrato.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CAMPOS_OPCIONAIS = [
  ['empresa_terceira', 255],
  ['placa', 20],
  ['modelo', 100],
  ['observacao', 2000],
];

function erroValidacao(message) {
  const erro = new Error(message);
  erro.statusCode = 400;
  return erro;
}

function textoOpcional(valor, campo, limite) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== 'string') throw erroValidacao(`O campo ${campo} deve ser texto.`);
  const limpo = valor.trim();
  if (limpo.length > limite) throw erroValidacao(`O campo ${campo} aceita no maximo ${limite} caracteres.`);
  return limpo || null;
}

// `parcial` = PUT: so valida/atualiza o que veio no corpo.
function validarDados(body = {}, { parcial = false } = {}) {
  const dados = {};

  if (!parcial || body.tag !== undefined) {
    const tag = typeof body.tag === 'string' ? body.tag.trim().toUpperCase() : '';
    if (!tag) throw erroValidacao('Informe a TAG do veiculo terceiro.');
    if (!tagSemEspaco(tag)) throw erroValidacao(MENSAGEM_TAG);
    if (tag.length > 50) throw erroValidacao('A TAG aceita no maximo 50 caracteres.');
    dados.tag = tag;
  }
  if (!parcial || body.tipo !== undefined) {
    const tipo = typeof body.tipo === 'string' ? body.tipo.trim() : '';
    if (!tipo) throw erroValidacao('Informe o tipo de veiculo.');
    if (tipo.length > 100) throw erroValidacao('O tipo aceita no maximo 100 caracteres.');
    dados.tipo = tipo;
  }
  for (const [campo, limite] of CAMPOS_OPCIONAIS) {
    const valor = textoOpcional(body[campo], campo, limite);
    if (valor !== undefined) dados[campo] = campo === 'placa' && valor ? valor.toUpperCase() : valor;
  }
  if (body.foto_url !== undefined) {
    const foto = textoOpcional(body.foto_url, 'foto_url', 2000);
    // Mesma regra da frota: somente URL do Cloudinary, nunca binario/base64.
    if (foto) validarUrlMidia(foto, 'foto_url');
    dados.foto_url = foto;
  }
  return dados;
}

// TAG unica em todo o sistema: a Programacao identifica cada linha pela TAG,
// entao um terceiro nao pode reutilizar a TAG de um veiculo da frota (nem de
// um veiculo na lixeira, que pode ser restaurado).
async function garantirTagLivre(tag, idAtual = null) {
  const [frota, terceiro] = await Promise.all([
    prisma.mobDesmob.findUnique({ where: { tag }, select: { tag: true } }),
    prisma.veiculoTerceiro.findUnique({ where: { tag }, select: { id: true } }),
  ]);
  if (frota) {
    const erro = new Error(`A TAG ${tag} ja pertence a um veiculo da frota propria.`);
    erro.statusCode = 409;
    throw erro;
  }
  if (terceiro && terceiro.id !== idAtual) {
    const erro = new Error(`Ja existe um veiculo terceiro com a TAG ${tag}.`);
    erro.statusCode = 409;
    throw erro;
  }
}

export const listarVeiculosTerceiros = asyncHandler(async (req, res) => {
  const veiculos = await prisma.veiculoTerceiro.findMany({
    where: filtroContrato(req),
    orderBy: [{ tipo: 'asc' }, { tag: 'asc' }],
  });
  res.json({ data: veiculos });
});

export const criarVeiculoTerceiro = asyncHandler(async (req, res) => {
  const dados = validarDados(req.body);
  await garantirTagLivre(dados.tag);
  // Servico do veiculo terceiro: o contrato do usuario (Master escolhe).
  const contrato = contratoParaGravar(req, req.body?.contrato);
  const veiculo = await prisma.veiculoTerceiro.create({ data: { ...dados, contrato } });
  await registrarLogAtividade(req, {
    acao: 'CRIAR_VEICULO_TERCEIRO',
    modulo: 'Frota',
    detalhes: { tag: veiculo.tag, tipo: veiculo.tipo, empresa_terceira: veiculo.empresa_terceira },
  });
  res.status(201).json({ data: veiculo });
});

export const atualizarVeiculoTerceiro = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'ID invalido', message: 'Identificador invalido.' });
  const atual = await prisma.veiculoTerceiro.findUnique({ where: { id } });
  if (!atual) return res.status(404).json({ error: 'Nao encontrado', message: 'Veiculo terceiro nao encontrado.' });

  const dados = validarDados(req.body, { parcial: true });
  if (dados.tag && dados.tag !== atual.tag) await garantirTagLivre(dados.tag, id);
  const veiculo = await prisma.veiculoTerceiro.update({ where: { id }, data: dados });
  res.json({ data: veiculo });
});

export const deletarVeiculoTerceiro = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'ID invalido', message: 'Identificador invalido.' });
  const atual = await prisma.veiculoTerceiro.findUnique({ where: { id }, select: { id: true, tag: true, tipo: true } });
  if (!atual) return res.status(404).json({ error: 'Nao encontrado', message: 'Veiculo terceiro nao encontrado.' });

  await prisma.veiculoTerceiro.delete({ where: { id } });
  await registrarLogAtividade(req, {
    acao: 'EXCLUIR_VEICULO_TERCEIRO',
    modulo: 'Frota',
    detalhes: { tag: atual.tag, tipo: atual.tipo },
  });
  res.status(204).send();
});
