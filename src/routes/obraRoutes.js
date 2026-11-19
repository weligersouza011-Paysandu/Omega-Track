// ============================================================================
// src/routes/obraRoutes.js — Gestão de Obras
//   GET    /api/obras      (login obrigatorio — alimenta o dropdown da Parte Diária)
//   GET    /api/obras/:id  (login obrigatorio)
//   POST   /api/obras      (restrito: Gestão/Transporte ou ADM Master)
//   PUT    /api/obras/:id  (restrito)
//   DELETE /api/obras/:id  (restrito)
// Sessão via `Authorization: Bearer <token>` (login).
// ============================================================================
import { Router } from 'express';
import {
  listarObras,
  buscarObra,
  criarObra,
  atualizarObra,
  deletarObra,
} from '../controllers/obraController.js';
import { requerAdmin, requerSessao } from '../middleware/sessao.js';

const SETORES_ESCRITA = ['GESTAO', 'PLANEJADOR', 'TRANSPORTE'];

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

router.get('/', requerSessao, listarObras);
router.get('/:id', requerSessao, buscarObra);
router.post('/', requerAdmin, requerGestaoTransporte, criarObra);
router.put('/:id', requerAdmin, requerGestaoTransporte, atualizarObra);
router.delete('/:id', requerAdmin, requerGestaoTransporte, deletarObra);

export default router;
