// ============================================================================
// RBAC por setor (frontend): define escrita vs. somente-leitura por modulo.
//   MEIO_AMBIENTE: escreve nos modulos ambientais; transporte e read-only.
//   TRANSPORTE:    escreve nos modulos de transporte; ambiental e read-only.
//   GESTAO:        escrita total.
//   PLANEJADOR:    mesmas atribuicoes da Gestao (separado so por setor).
// Uso: desabilite botoes/formularios quando `podeEscrever` for false.
// ============================================================================

export const MODULOS_TRANSPORTE = ['inicio', 'obras', 'frota', 'programacao-recursos', 'pendencias-parte-diaria', 'telemetria'];
export const MODULOS_AMBIENTAIS = ['controle-ambiental', 'controle-combustivel', 'ecogestao'];

// Meio Ambiente enxerga os modulos ambientais e a mobilizacao da frota (so as informacoes
// essenciais do veiculo; edita apenas o combustivel). Gestao, Planejador, Transporte e Master
// enxergam todos os modulos (Transporte: os ambientais somente em leitura).
export const MODULOS_MEIO_AMBIENTE = ['frota', 'controle-ambiental', 'controle-combustivel', 'ecogestao', 'usuarios', 'perfil'];

export const SETOR_LABEL = {
  MEIO_AMBIENTE: 'Meio Ambiente',
  TRANSPORTE: 'Transporte',
  GESTAO: 'Gestão',
  PLANEJADOR: 'Planejador',
};

export function ehMaster(usuario) {
  return !!usuario && usuario.tipo === 'ADMINISTRADOR' && usuario.nivel === 'MASTER';
}

/** Meio Ambiente (nao Master): visao restrita. */
export function ehMeioAmbiente(usuario) {
  return !!usuario && usuario.tipo === 'ADMINISTRADOR' && usuario.setor === 'MEIO_AMBIENTE' && usuario.nivel !== 'MASTER';
}

/** Transporte (nao Master): modulos ambientais so em leitura. */
export function ehTransporteSomente(usuario) {
  return !!usuario && usuario.tipo === 'ADMINISTRADOR' && usuario.setor === 'TRANSPORTE' && usuario.nivel !== 'MASTER';
}

/** O setor do usuario enxerga este modulo? (Operacional tem as regras proprias do App.) */
export function podeVerModulo(usuario, modulo) {
  if (!ehMeioAmbiente(usuario)) return true;
  return MODULOS_MEIO_AMBIENTE.includes(modulo);
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
  if (usuario.setor === 'GESTAO' || usuario.setor === 'PLANEJADOR') return true;
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
