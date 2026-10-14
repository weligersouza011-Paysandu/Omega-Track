// ============================================================================
// src/routes/obraRoutes.js — Gestão de Obras
//   GET    /api/obras      (aberto — alimenta o dropdown da Parte Diária)
//   GET    /api/obras/:id  (aberto)
//   POST   /api/obras      (restrito: Gestão/Transporte ou ADM Master)
//   PUT    /api/obras/:id  (restrito)
//   DELETE /api/obras/:id  (restrito)
// Sessão via `Authorization: Bearer <token>` (login) com fallback para
// `x-acting-matricula` (mesmo padrão das demais rotas de gestão).
// ============================================================================
import { Router } from 'express';
import {
  listarObras,
  buscarObra,
  criarObra,
  atualizarObra,
  deletarObra,
} from '../controllers/obraController.js';
import { requerAdmin } from '../middleware/sessao.js';

const SETORES_ESCRITA = ['GESTAO', 'TRANSPORTE'];

function requerGestaoTransporte(req, res, next) {
  const atuante = req.atuante;
  const ehMaster = atuante?.nivel === 'MASTER';
  const setorPermitido = atuante && SETORES_ESCRITA.includes(atuante.setor);
  if (!ehMaster && !setorPermitido) {
    return res.status(403).json({
      error: 'Sem permissao',
      message: 'Apenas usuarios de Gestao/Transporte ou ADM Master podem gerenciar obras.',
    });
  }
  next();
}

const router = Router();

router.get('/', listarObras);
router.get('/:id', buscarObra);
router.post('/', requerAdmin, requerGestaoTransporte, criarObra);
router.put('/:id', requerAdmin, requerGestaoTransporte, atualizarObra);
router.delete('/:id', requerAdmin, requerGestaoTransporte, deletarObra);

export default router;
