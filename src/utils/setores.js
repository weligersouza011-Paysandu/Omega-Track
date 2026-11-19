// Planejador tem as mesmas atribuicoes de Gestao; o setor separado existe
// apenas para organizar/filtrar usuarios e vincular o planejador as obras.
export const SETORES_GESTAO = ['GESTAO', 'PLANEJADOR'];

export function ehSetorGestao(setor) {
  return SETORES_GESTAO.includes(setor);
}

// ---------------------------------------------------------------------------
// Visibilidade por setor (dentro do contrato do usuario).
//   GESTAO / PLANEJADOR / MASTER: tudo do contrato (Master: todos os contratos).
//   TRANSPORTE: modulos de transporte; modulos ambientais so em leitura.
//   MEIO_AMBIENTE: modulos ambientais + lista de mobilizacao da frota (so as
//   informacoes essenciais do veiculo; edita apenas o combustivel).
// Perfil OPERACIONAL nao tem setor e segue as regras proprias (so as proprias partes).
// ---------------------------------------------------------------------------
export const CAMPOS_VEICULO_MEIO_AMBIENTE = ['combustivel'];

export function ehMeioAmbiente(usuario) {
  return !!usuario && usuario.tipo === 'ADMINISTRADOR' && usuario.setor === 'MEIO_AMBIENTE' && usuario.nivel !== 'MASTER';
}

export function ehTransporteSomente(usuario) {
  return !!usuario && usuario.tipo === 'ADMINISTRADOR' && usuario.setor === 'TRANSPORTE' && usuario.nivel !== 'MASTER';
}
