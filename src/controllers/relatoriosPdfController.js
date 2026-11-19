import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { lerSessao } from '../middleware/sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LIMITE_LOTE_RELATORIOS = 50;

// Somente os campos usados no modelo oficial. Não carrega logs, contadores
// ou comentários e não incrementa visualizações a cada download do lote.
const CAMPOS_RELATORIO = {
  id: true, numero_relatorio: true, id_relatorio: true, data: true, tag: true,
  numero_contrato: true, obra: true, obra_id: true, contratante: true,
  responsavel: true, planejador: true, funcionario: true, operador: true,
  funcao: true, criado_por: true, status: true, status_operacional: true,
  status_relatorio: true, status_aprovacao: true, status_assinatura: true,
  horario_entrada: true, horario_saida: true, intervalo_entrada: true,
  intervalo_saida: true, km_inicial: true, km_final: true,
  veiculo: { select: { placa: true, modelo: true, status: true } },
  obra_ref: { select: { id: true, nome: true } },
  mao_obra: { orderBy: { created_at: 'asc' }, select: { nome: true, matricula: true, funcao: true, observacao: true } },
  equipamentos: { orderBy: { created_at: 'asc' }, select: { tag_patrimonio: true, descricao: true, status: true } },
  atividades: { orderBy: { created_at: 'asc' }, select: { descricao: true, status: true } },
  ocorrencias: { orderBy: { created_at: 'asc' }, select: { tipo: true, descricao: true } },
  fotos: { orderBy: { created_at: 'asc' }, select: { url: true, legenda: true } },
  assinaturas: { orderBy: { created_at: 'asc' }, select: {
    etapa: true, nome: true, matricula: true, assinatura_dado: true, assinado_em: true,
  } },
};

export const buscarRelatoriosPdfLote = asyncHandler(async (req, res) => {
  // A exportação nova exige JWT e revalida o usuário, sem o fallback demo.
  const sessao = lerSessao(req);
  if (!sessao?.sub) return res.status(401).json({ message: 'Faça login para exportar os relatórios.' });
  const usuario = await prisma.usuario.findUnique({
    where: { id: sessao.sub }, select: { id: true, tipo: true, nivel: true, contrato: true, matricula: true, nome: true },
  });
  if (!usuario) return res.status(401).json({ message: 'Sessão inválida. Faça login novamente.' });
  if (!['ADMINISTRADOR', 'OPERACIONAL'].includes(usuario.tipo)) {
    return res.status(403).json({ message: 'Sem permissão para exportar relatórios.' });
  }
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((id) => typeof id === 'string' ? id.toLowerCase() : id) : req.body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > LIMITE_LOTE_RELATORIOS
    || ids.some((id) => typeof id !== 'string' || !UUID.test(id)) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ message: `Informe entre 1 e ${LIMITE_LOTE_RELATORIOS} IDs de relatórios distintos e válidos.` });
  }
  const where = { id: { in: ids }, deletado_em: null, veiculo: { deletado_em: null } };
  // Fora do proprio contrato (exceto Master) o relatorio nao esta disponivel.
  if (!(usuario.tipo === 'ADMINISTRADOR' && usuario.nivel === 'MASTER')) where.contrato = usuario.contrato;
  if (usuario.tipo === 'OPERACIONAL') {
    where.OR = [
      { operador: usuario.matricula },
      { funcionario: { contains: usuario.matricula, mode: 'insensitive' } },
      ...(usuario.nome ? [{ funcionario: { contains: usuario.nome, mode: 'insensitive' } }] : []),
    ];
  }
  const partes = await prisma.parteDiaria.findMany({ where, select: CAMPOS_RELATORIO });
  if (partes.length !== ids.length) {
    return res.status(409).json({ message: 'Um ou mais relatórios foram removidos ou não estão disponíveis para seu usuário. Atualize a consulta.' });
  }
  const porId = new Map(partes.map((parte) => [parte.id, parte]));
  res.set('Cache-Control', 'no-store');
  return res.json({ data: ids.map((id) => porId.get(id)) });
});
