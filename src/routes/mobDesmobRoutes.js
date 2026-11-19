import { Router } from 'express';
import {
  listarVeiculos,
  buscarVeiculoPorTag,
  buscarVeiculoPorPlaca,
  buscarStatusManutencao,
  registrarPreventiva,
  criarVeiculo,
  atualizarVeiculo,
  atualizarDadosTecnicosVeiculo,
  deletarVeiculo,
  desmobilizarVeiculo,
  atualizarFotoVeiculo,
  vincularTelemetriaPorPlaca,
} from '../controllers/mobDesmobController.js';
import { requerAdmin, requerMaster, requerSessao } from '../middleware/sessao.js';
import { paramContrato } from '../middleware/escopo.js';
import prisma from '../config/database.js';

const router = Router();

// Escopo por contrato: veiculo de outro contrato responde 404 (Master enxerga todos).
const contratoDoVeiculo = (campo) => async (valor) => (await prisma.mobDesmob.findFirst({
  where: { [campo]: { equals: String(valor), mode: 'insensitive' } },
  select: { contrato: true },
}))?.contrato;
router.param('tag', paramContrato(contratoDoVeiculo('tag')));
router.param('placa', paramContrato(contratoDoVeiculo('placa')));

router.get('/', requerSessao, listarVeiculos);
router.get('/tag/:tag', requerSessao, buscarVeiculoPorTag);
router.get('/placa/:placa', requerSessao, buscarVeiculoPorPlaca);
router.get('/placa/:placa/telemetria', requerSessao, vincularTelemetriaPorPlaca);
// Diagnóstico da preventiva (antes das rotas `/:tag` de escrita — sem conflito).
router.get('/:tag/status-manutencao', requerSessao, buscarStatusManutencao);
router.post('/:tag/preventiva', requerAdmin, registrarPreventiva);
router.post('/', requerAdmin, criarVeiculo);
router.put('/:tag/desmobilizar', requerAdmin, desmobilizarVeiculo);
// Edição rápida dos dados técnicos (ficha do veículo) — atualização parcial.
router.patch('/:tag', requerAdmin, atualizarDadosTecnicosVeiculo);
router.put('/:tag', requerAdmin, atualizarVeiculo);
router.post('/:tag/foto', requerAdmin, atualizarFotoVeiculo);
router.delete('/:tag', requerAdmin, requerMaster, deletarVeiculo);

export default router;
