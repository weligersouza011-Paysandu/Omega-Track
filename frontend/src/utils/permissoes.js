// ============================================================================
// RBAC por setor (frontend): define escrita vs. somente-leitura por modulo.
//   MEIO_AMBIENTE: escreve nos modulos ambientais; transporte e read-only.
//   TRANSPORTE:    escreve nos modulos de transporte; ambiental e read-only.
//   GESTAO:        escrita total.
// Uso: desabilite botoes/formularios quando `podeEscrever` for false.
// ============================================================================

export const MODULOS_TRANSPORTE = ['inicio', 'obras', 'frota', 'pendencias-parte-diaria', 'telemetria'];
export const MODULOS_AMBIENTAIS = ['controle-ambiental', 'ecogestao'];

export const SETOR_LABEL = {
  MEIO_AMBIENTE: 'Meio Ambiente',
  TRANSPORTE: 'Transporte',
  GESTAO: 'Gestão',
};

export function ehMaster(usuario) {
  return !!usuario && usuario.tipo === 'ADMINISTRADOR' && usuario.nivel === 'MASTER';
}

export function ehOperacional(usuario) {
  return !!usuario && usuario.tipo === 'OPERACIONAL';
}

// Visibilidade das Partes Diarias (pagina Inicio):
// ADM / Gestao / Transporte (tipo ADMINISTRADOR, qualquer setor/nivel)
// enxergam TODAS; Operacional enxerga apenas as proprias
// (filtradas pela matricula/ID no campo operador).
export function podeVerTodasPartes(usuario) {
  return !!usuario && usuario.tipo === 'ADMINISTRADOR';
}

// Status Operacional do Dia (Operacao vs paradas/manutencoes): somente
// perfis administrativos (Master/Transporte/Gestao) alternam. Usuario
// operacional permanece fixado em 'Operacao'.
export function podeAlterarStatusOperacional(usuario) {
  return !!usuario && usuario.tipo === 'ADMINISTRADOR';
}

export function podeEscrever(usuario, modulo) {
  if (!usuario || usuario.tipo !== 'ADMINISTRADOR') return false;
  if (usuario.setor === 'GESTAO') return true;
  if (usuario.setor === 'MEIO_AMBIENTE') return MODULOS_AMBIENTAIS.includes(modulo);
  if (usuario.setor === 'TRANSPORTE') return MODULOS_TRANSPORTE.includes(modulo);
  return false;
}

const CHAVE_ATUANTE = 'omegatrack_acting_matricula';

export function lerAtuante() {
  try {
    return localStorage.getItem(CHAVE_ATUANTE) || '';
  } catch {
    return '';
  }
}

export function salvarAtuante(matricula) {
  try {
    if (matricula) localStorage.setItem(CHAVE_ATUANTE, matricula);
    else localStorage.removeItem(CHAVE_ATUANTE);
  } catch {
    /* armazenamento indisponivel */
  }
}

export function actingHeaders(atuanteMatricula) {
  const h = { 'Content-Type': 'application/json' };
  if (atuanteMatricula) h['x-acting-matricula'] = atuanteMatricula;
  return h;
}
