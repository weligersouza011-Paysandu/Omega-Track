import { Router } from 'express';
import {
  listarVeiculos,
  buscarVeiculoPorTag,
  buscarVeiculoPorPlaca,
  buscarStatusManutencao,
  registrarPreventiva,
  criarVeiculo,
  atualizarVeiculo,
  deletarVeiculo,
  desmobilizarVeiculo,
  atualizarFotoVeiculo,
  vincularTelemetriaPorPlaca,
} from '../controllers/mobDesmobController.js';
import { requerAdmin, requerMaster } from '../middleware/sessao.js';

const router = Router();

router.get('/', listarVeiculos);
router.get('/tag/:tag', buscarVeiculoPorTag);
router.get('/placa/:placa', buscarVeiculoPorPlaca);
router.get('/placa/:placa/telemetria', vincularTelemetriaPorPlaca);
// Diagnóstico da preventiva (antes das rotas `/:tag` de escrita — sem conflito).
router.get('/:tag/status-manutencao', buscarStatusManutencao);
router.post('/:tag/preventiva', registrarPreventiva);
router.post('/', criarVeiculo);
router.put('/:tag/desmobilizar', desmobilizarVeiculo);
router.put('/:tag', atualizarVeiculo);
router.post('/:tag/foto', atualizarFotoVeiculo);
router.delete('/:tag', requerAdmin, requerMaster, deletarVeiculo);

export default router;
