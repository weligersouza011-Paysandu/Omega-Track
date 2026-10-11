import { Router } from 'express';
import {
  listarVeiculos,
  buscarVeiculoPorTag,
  buscarVeiculoPorPlaca,
  criarVeiculo,
  atualizarVeiculo,
  deletarVeiculo,
  vincularTelemetriaPorPlaca,
} from '../controllers/mobDesmobController.js';

const router = Router();

router.get('/', listarVeiculos);
router.get('/tag/:tag', buscarVeiculoPorTag);
router.get('/placa/:placa', buscarVeiculoPorPlaca);
router.get('/placa/:placa/telemetria', vincularTelemetriaPorPlaca);
router.post('/', criarVeiculo);
router.put('/:tag', atualizarVeiculo);
router.delete('/:tag', deletarVeiculo);

export default router;
