// ============================================================================
// Troca de contrato COM DATA EFETIVA.
//   - Veiculo: registros (partes diarias, programacao, abastecimentos e
//     telemetria) da data efetiva em diante passam ao contrato novo; o que veio
//     antes permanece no contrato antigo (historico). O historico de vigencias
//     fica em `veiculo_contrato_historico`.
//   - Usuario: passa a pertencer ao contrato novo; o que ele lancou antes ja
//     esta carimbado com o contrato de origem e nao muda.
// So o Master troca contrato.
// ============================================================================
import prisma from '../config/database.js';
import { exigirContrato } from '../utils/contrato.js';
import { bloquearEquipamentos } from '../controllers/programacaoRecursosLocks.js';
import { resolverLocacao } from '../utils/locacao.js';

const DIA_MS = 24 * 60 * 60 * 1000;
const FUSO_LOCAL_MS = 3 * 60 * 60 * 1000; // America/Belem (-03:00)

function erroHttp(status, error, message, extra = {}) {
  const erro = new Error(message);
  erro.statusCode = status;
  erro.error = error;
  Object.assign(erro, extra);
  return erro;
}

const isoHoje = () => new Date(Date.now() - FUSO_LOCAL_MS).toISOString().slice(0, 10);
const isoDe = (data) => new Date(data).toISOString().slice(0, 10);

/** 'AAAA-MM-DD' real e que nao esteja no futuro; devolve a data (UTC 00:00). */
export function lerDataEfetiva(valor) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  const data = /^\d{4}-\d{2}-\d{2}$/.test(texto) ? new Date(`${texto}T00:00:00.000Z`) : null;
  if (!data || Number.isNaN(data.getTime()) || isoDe(data) !== texto) {
    throw erroHttp(400, 'Data invalida', 'Informe o dia da troca no formato AAAA-MM-DD.');
  }
  if (texto > isoHoje()) {
    throw erroHttp(400, 'Data invalida', 'O dia da troca não pode estar no futuro.');
  }
  return data;
}

/** Instante em que o dia (local, -03:00) comeca, para colunas com hora. */
const inicioDoDiaLocal = (dia) => new Date(dia.getTime() + FUSO_LOCAL_MS);

export async function historicoContratoVeiculo(tag) {
  const veiculo = await prisma.mobDesmob.findFirst({
    where: { tag: { equals: String(tag), mode: 'insensitive' } },
    select: { tag: true, contrato: true, data_mob: true, created_at: true },
  });
  if (!veiculo) throw erroHttp(404, 'Nao encontrado', 'Veiculo nao encontrado.');
  const linhas = await prisma.veiculoContratoHistorico.findMany({
    where: { tag: veiculo.tag },
    orderBy: { vigente_desde: 'desc' },
  });
  const historico = linhas.map((l) => ({
    contrato: l.contrato,
    vigente_desde: isoDe(l.vigente_desde),
    vigente_ate: l.vigente_ate ? isoDe(l.vigente_ate) : null,
    alterado_por: l.alterado_por,
  }));
  // Veiculo sem registro de historico (criado antes do recurso): mostra o contrato atual.
  if (!historico.length) {
    historico.push({ contrato: veiculo.contrato, vigente_desde: isoDe(veiculo.data_mob ?? veiculo.created_at), vigente_ate: null, alterado_por: null });
  }
  return { tag: veiculo.tag, contrato_atual: veiculo.contrato, historico };
}

export async function transferirContratoVeiculo({ tag, contrato, dataEfetiva, locacao = null, confirmarLimpeza = false, autor = null }) {
  const novo = exigirContrato(contrato, 'Novo contrato');
  const dia = lerDataEfetiva(dataEfetiva);

  return prisma.$transaction(async (tx) => {
    await bloquearEquipamentos(tx, [String(tag).toUpperCase()]);
    const veiculo = await tx.mobDesmob.findFirst({
      where: { tag: { equals: String(tag), mode: 'insensitive' }, deletado_em: null },
    });
    if (!veiculo) throw erroHttp(404, 'Nao encontrado', 'Veiculo nao encontrado.');
    if (veiculo.contrato === novo) {
      throw erroHttp(400, 'Contrato igual', `O veículo ${veiculo.tag} já está no contrato ${novo}.`);
    }

    // Vigencia atual (veiculos anteriores ao recurso ganham a linha de base agora).
    let atual = await tx.veiculoContratoHistorico.findFirst({
      where: { tag: veiculo.tag, vigente_ate: null },
      orderBy: { vigente_desde: 'desc' },
    });
    if (!atual) {
      atual = await tx.veiculoContratoHistorico.create({
        data: {
          tag: veiculo.tag, contrato: veiculo.contrato,
          vigente_desde: new Date(`${isoDe(veiculo.data_mob ?? veiculo.created_at)}T00:00:00.000Z`),
          alterado_por: 'base do historico',
        },
      });
    }
    if (dia.getTime() <= new Date(atual.vigente_desde).getTime()) {
      throw erroHttp(400, 'Data invalida',
        `A troca precisa ser depois do início do contrato atual (${isoDe(atual.vigente_desde)}): até lá o veículo não teria registros no contrato ${veiculo.contrato}.`);
    }

    // A programacao do veiculo daqui em diante e do contrato antigo (obras dele): precisa de confirmacao.
    const programacoes = await tx.programacaoRecurso.count({ where: { tag: veiculo.tag, data: { gte: dia } } });
    if (programacoes > 0 && !confirmarLimpeza) {
      throw erroHttp(409, 'Programacao existente',
        `O veículo tem ${programacoes} dia(s) programado(s) a partir de ${isoDe(dia)} em obras do contrato ${veiculo.contrato}. Confirme para removê-los e concluir a troca.`,
        { codigo: 'PROGRAMACAO_FUTURA', programacoes });
    }
    if (programacoes > 0) {
      await tx.programacaoRecurso.deleteMany({ where: { tag: veiculo.tag, data: { gte: dia } } });
    }

    // Partes ja lancadas a partir da data que apontam para obra do contrato antigo (so avisa).
    const partesComObraAntiga = await tx.parteDiaria.count({
      where: { tag: veiculo.tag, data: { gte: dia }, deletado_em: null, obra_ref: { is: { contrato: veiculo.contrato } } },
    });

    await tx.veiculoContratoHistorico.update({
      where: { id: atual.id },
      data: { vigente_ate: new Date(dia.getTime() - DIA_MS) },
    });
    await tx.veiculoContratoHistorico.create({
      data: { tag: veiculo.tag, contrato: novo, vigente_desde: dia, alterado_por: autor },
    });
    // A locacao pertence ao contrato: no contrato novo vale a informada (ou nenhuma).
    const locacaoNova = await resolverLocacao(tx, novo, locacao);
    await tx.mobDesmob.update({ where: { tag: veiculo.tag }, data: { contrato: novo, locacao: locacaoNova } });

    // Da data efetiva em diante: tudo do veiculo passa ao contrato novo. Antes: permanece.
    const desde = inicioDoDiaLocal(dia);
    const [partes, abastecimentos, telemetria] = await Promise.all([
      tx.parteDiaria.updateMany({ where: { tag: veiculo.tag, data: { gte: dia } }, data: { contrato: novo } }),
      tx.abastecimento.updateMany({ where: { tag: veiculo.tag, data_transacao: { gte: desde } }, data: { contrato: novo } }),
      tx.eventoTelemetria.updateMany({ where: { tag: veiculo.tag, data_hora: { gte: desde } }, data: { contrato: novo } }),
    ]);

    return {
      tag: veiculo.tag,
      de: veiculo.contrato,
      para: novo,
      locacao: locacaoNova,
      data_efetiva: isoDe(dia),
      transferidos: { partes_diarias: partes.count, abastecimentos: abastecimentos.count, eventos_telemetria: telemetria.count },
      programacao_removida: programacoes,
      partes_com_obra_do_contrato_antigo: partesComObraAntiga,
    };
  });
}

export async function transferirContratoUsuario({ id, contrato, dataEfetiva, autor = null }) {
  const novo = exigirContrato(contrato, 'Novo contrato');
  const dia = lerDataEfetiva(dataEfetiva);
  const usuario = await prisma.usuario.findUnique({ where: { id }, select: { id: true, nome: true, matricula: true, contrato: true } });
  if (!usuario) throw erroHttp(404, 'Nao encontrado', 'Usuario nao encontrado.');
  if (usuario.contrato === novo) {
    throw erroHttp(400, 'Contrato igual', `${usuario.nome} já está no contrato ${novo}.`);
  }
  const de = usuario.contrato;
  const atualizado = await prisma.usuario.update({ where: { id }, data: { contrato: novo } });
  return { usuario: atualizado, de, para: novo, data_efetiva: isoDe(dia), autor };
}
