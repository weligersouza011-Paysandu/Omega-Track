// Chat de suporte: usuario <-> desenvolvedor (Master). Todos os Master veem as mesmas
// conversas; o usuario comum so ve a propria (a chave da conversa e a matricula do JWT,
// nunca um valor enviado pelo cliente).
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { ehMaster } from '../middleware/escopo.js';

const MAX_TEXTO = 2000;
const LIMITE_RAJADA = 20; // mensagens de um usuario em 10 minutos

function lerTexto(req, res) {
  const texto = String(req.body?.texto ?? '').trim();
  if (!texto) {
    res.status(400).json({ error: 'Mensagem vazia', message: 'Escreva a mensagem antes de enviar.' });
    return null;
  }
  if (texto.length > MAX_TEXTO) {
    res.status(400).json({ error: 'Mensagem longa', message: `A mensagem pode ter ate ${MAX_TEXTO} caracteres.` });
    return null;
  }
  return texto;
}

const visivel = (m) => ({
  id: m.id, de_dev: m.de_dev, autor_nome: m.autor_nome, texto: m.texto, lida: m.lida, created_at: m.created_at,
});

// GET /api/suporte/minha — conversa do proprio usuario (marca as respostas como lidas).
export const minhaConversa = asyncHandler(async (req, res) => {
  const matricula = req.atuante.matricula;
  const mensagens = await prisma.suporteMensagem.findMany({
    where: { conversa_matricula: matricula }, orderBy: { created_at: 'asc' }, take: 300,
  });
  await prisma.suporteMensagem.updateMany({ where: { conversa_matricula: matricula, de_dev: true, lida: false }, data: { lida: true } });
  res.json({ data: mensagens.map(visivel) });
});

// POST /api/suporte/minha { texto } — o usuario escreve para o desenvolvedor.
export const enviarMinhaMensagem = asyncHandler(async (req, res) => {
  const u = req.atuante;
  if (ehMaster(u)) {
    return res.status(400).json({ error: 'Use a caixa de entrada', message: 'Master responde pelas conversas dos usuarios.' });
  }
  const texto = lerTexto(req, res);
  if (texto === null) return undefined;
  const recentes = await prisma.suporteMensagem.count({
    where: { conversa_matricula: u.matricula, de_dev: false, created_at: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
  });
  if (recentes >= LIMITE_RAJADA) {
    return res.status(429).json({ error: 'Muitas mensagens', message: 'Aguarde alguns minutos antes de enviar mais mensagens.' });
  }
  const criada = await prisma.suporteMensagem.create({
    data: {
      conversa_matricula: u.matricula, conversa_nome: u.nome, conversa_contrato: u.contrato,
      de_dev: false, autor_nome: u.nome, autor_matricula: u.matricula, texto,
    },
  });
  return res.status(201).json({ data: visivel(criada) });
});

// GET /api/suporte/nao-lidas — usuario: respostas novas; Master: mensagens novas de usuarios.
export const naoLidas = asyncHandler(async (req, res) => {
  const u = req.atuante;
  const where = ehMaster(u)
    ? { de_dev: false, lida: false }
    : { conversa_matricula: u.matricula, de_dev: true, lida: false };
  res.json({ total: await prisma.suporteMensagem.count({ where }) });
});

// GET /api/suporte/conversas (Master) — uma linha por usuario, com nao lidas primeiro.
export const listarConversas = asyncHandler(async (_req, res) => {
  const ultimas = await prisma.suporteMensagem.findMany({
    distinct: ['conversa_matricula'], orderBy: [{ conversa_matricula: 'asc' }, { created_at: 'desc' }],
  });
  const pendentes = await prisma.suporteMensagem.groupBy({
    by: ['conversa_matricula'], where: { de_dev: false, lida: false }, _count: { _all: true },
  });
  const porMatricula = new Map(pendentes.map((p) => [p.conversa_matricula, p._count._all]));
  const dados = ultimas
    .map((m) => ({
      matricula: m.conversa_matricula, nome: m.conversa_nome, contrato: m.conversa_contrato,
      ultima_mensagem: m.texto, ultima_de_dev: m.de_dev, ultima_em: m.created_at,
      nao_lidas: porMatricula.get(m.conversa_matricula) || 0,
    }))
    .sort((a, b) => (b.nao_lidas > 0) - (a.nao_lidas > 0) || new Date(b.ultima_em) - new Date(a.ultima_em));
  res.json({ data: dados });
});

// GET /api/suporte/conversas/:matricula (Master) — abre a conversa (marca as do usuario como lidas).
export const abrirConversa = asyncHandler(async (req, res) => {
  const matricula = String(req.params.matricula).slice(0, 50);
  const mensagens = await prisma.suporteMensagem.findMany({
    where: { conversa_matricula: matricula }, orderBy: { created_at: 'asc' }, take: 300,
  });
  await prisma.suporteMensagem.updateMany({ where: { conversa_matricula: matricula, de_dev: false, lida: false }, data: { lida: true } });
  res.json({ data: mensagens.map(visivel) });
});

// POST /api/suporte/conversas/:matricula { texto } (Master) — resposta do desenvolvedor.
export const responderConversa = asyncHandler(async (req, res) => {
  const matricula = String(req.params.matricula).slice(0, 50);
  const base = await prisma.suporteMensagem.findFirst({ where: { conversa_matricula: matricula, de_dev: false }, orderBy: { created_at: 'desc' } });
  if (!base) return res.status(404).json({ error: 'Nao encontrado', message: 'Conversa nao encontrada.' });
  const texto = lerTexto(req, res);
  if (texto === null) return undefined;
  const criada = await prisma.suporteMensagem.create({
    data: {
      conversa_matricula: matricula, conversa_nome: base.conversa_nome, conversa_contrato: base.conversa_contrato,
      de_dev: true, autor_nome: req.atuante.nome, autor_matricula: req.atuante.matricula, texto,
    },
  });
  return res.status(201).json({ data: visivel(criada) });
});
