// ============================================================================
// Acesso por setor. Usa o usuario ja carregado do JWT (sessaoOpcional); sem
// usuario, nao interfere: a rota continua exigindo login por conta propria.
// ============================================================================
import { ehMeioAmbiente, ehTransporteSomente } from '../utils/setores.js';

function negar(res, message) {
  return res.status(403).json({ error: 'Sem permissao', message });
}

/** Modulos de transporte: o setor Meio Ambiente nao acessa. */
export function bloquearMeioAmbiente(req, res, next) {
  if (ehMeioAmbiente(req.atuante)) {
    return negar(res, 'O setor Meio Ambiente não tem acesso a este módulo.');
  }
  return next();
}

/** Modulos ambientais: Transporte so le (GET/HEAD); escrever e do Meio Ambiente/Gestao/Master. */
export function ambientalSomenteLeituraParaTransporte(req, res, next) {
  const leitura = req.method === 'GET' || req.method === 'HEAD';
  if (!leitura && ehTransporteSomente(req.atuante)) {
    return negar(res, 'O setor Transporte acompanha os módulos ambientais somente em modo leitura.');
  }
  return next();
}
