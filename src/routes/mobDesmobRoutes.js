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

const router = Router();

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
