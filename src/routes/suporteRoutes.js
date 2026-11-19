import { Router } from 'express';
import { requerSessao, requerMaster } from '../middleware/sessao.js';
import {
  minhaConversa, enviarMinhaMensagem, naoLidas, listarConversas, abrirConversa, responderConversa,
} from '../controllers/suporteController.js';

// Chat de suporte (usuario <-> desenvolvedor). Qualquer usuario logado fala por /minha;
// so Master acessa as conversas de todos.
const router = Router();

router.get('/minha', requerSessao, minhaConversa);
router.post('/minha', requerSessao, enviarMinhaMensagem);
router.get('/nao-lidas', requerSessao, naoLidas);
router.get('/conversas', requerSessao, requerMaster, listarConversas);
router.get('/conversas/:matricula', requerSessao, requerMaster, abrirConversa);
router.post('/conversas/:matricula', requerSessao, requerMaster, responderConversa);

export default router;
