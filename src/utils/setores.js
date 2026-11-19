// Planejador tem as mesmas atribuicoes de Gestao; o setor separado existe
// apenas para organizar/filtrar usuarios e vincular o planejador as obras.
export const SETORES_GESTAO = ['GESTAO', 'PLANEJADOR'];

export function ehSetorGestao(setor) {
  return SETORES_GESTAO.includes(setor);
}
