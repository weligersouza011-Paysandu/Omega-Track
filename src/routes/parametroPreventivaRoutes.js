// ============================================================================
// src/routes/parametroPreventivaRoutes.js — Parâmetros de preventiva
//   GET    /api/parametros-preventiva                     (aberto)
//   GET    /api/parametros-preventiva/categoria/:tipo     (aberto)
//   POST   /api/parametros-preventiva                     (restrito: Gestão/Transporte ou ADM Master)
//   DELETE /api/parametros-preventiva/:id                 (restrito)
// Mesmo padrão de permissão de /api/obras.
// ============================================================================
import { Router } from 'express';
import {
  listarParametros,
  buscarPorCategoria,
  salvarParametro,
  removerParametro,
} from '../controllers/parametroPreventivaController.js';
import { requerAdmin } from '../middleware/sessao.js';

const SETORES_ESCRITA = ['GESTAO', 'TRANSPORTE'];

function requerGestaoTransporte(req, res, next) {
  const atuante = req.atuante;
  const ehMaster = atuante?.nivel === 'MASTER';
  const setorPermitido = atuante && SETORES_ESCRITA.includes(atuante.setor);
  if (!ehMaster && !setorPermitido) {
    return res.status(403).json({
      error: 'Sem permissao',
      message: 'Apenas usuarios de Gestao/Transporte ou ADM Master podem gerenciar parâmetros de preventiva.',
    });
  }
  next();
}

const router = Router();

router.get('/', listarParametros);
router.get('/categoria/:tipo', buscarPorCategoria);
router.post('/', requerAdmin, requerGestaoTransporte, salvarParametro);
router.delete('/:id', requerAdmin, requerGestaoTransporte, removerParametro);

export default router;
