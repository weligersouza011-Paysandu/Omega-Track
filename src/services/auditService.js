// ============================================================================
// src/services/auditService.js — trilha de auditoria global (LogAtividade).
// Best-effort: falha no log nunca desfaz a acao de negocio.
// ============================================================================
import prisma from '../config/database.js';
import { atuanteDaRequisicao } from '../middleware/sessao.js';

export const MODULOS_AUDITORIA = ['Frota', 'Eficiencia', 'ParteDiaria', 'Usuarios'];

function limparDetalhes(detalhes) {
  if (detalhes === undefined || detalhes === null) return null;
  try {
    const serializado = JSON.parse(JSON.stringify(detalhes));
    return serializado && typeof serializado === 'object' ? serializado : { valor: serializado };
  } catch {
    return { mensagem: String(detalhes) };
  }
}

export function ipDaRequisicao(req) {
  const forwarding = req?.headers?.['x-forwarded-for'];
  const ip = Array.isArray(forwarding)
    ? forwarding[0]
    : String(forwarding || '').split(',')[0].trim();
  return (ip || req?.ip || req?.socket?.remoteAddress || '').slice(0, 100) || null;
}

export async function registrarLogAtividade(req, { acao, modulo, detalhes = null, usuario = null } = {}) {
  if (!acao || !modulo) return null;
  try {
    const atuante = req?.atuante || await atuanteDaRequisicao(req);
    const nome = String(
      usuario?.nome
      || atuante?.nome
      || req?.headers?.['x-acting-nome']
      || req?.body?.atualizado_por
      || req?.body?.criado_por
      || 'Sistema'
    ).trim().slice(0, 255) || 'Sistema';
    const funcao = String(
      usuario?.funcao
      || atuante?.funcao
      || req?.body?.funcao
      || ''
    ).trim().slice(0, 100) || null;

    return await prisma.logAtividade.create({
      data: {
        usuario_id: usuario?.id || atuante?.id || null,
        nome_usuario: nome,
        funcao_usuario: funcao,
        acao: String(acao).toUpperCase().slice(0, 100),
        modulo: String(modulo).slice(0, 100),
        detalhes: limparDetalhes(detalhes),
        ip_address: ipDaRequisicao(req),
      },
    });
  } catch (e) {
    console.error('[auditoria] falha ao registrar atividade:', e.message);
    return null;
  }
}
