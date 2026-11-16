// Agrupamento da Programação de Recursos por categoria (campo `modelo` da frota
// própria / `tipo` do veículo terceiro). Usado pela tela e pelo PDF para que
// a ordem dos blocos seja a mesma nos dois.

export const SEM_CATEGORIA = 'Sem categoria';

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Ordem de relevância operacional: o que mais circula na reunião vem primeiro.
// `icone` é a chave usada pela tela para escolher o ícone do bloco.
const FAMILIAS = [
  { icone: 'leve', termos: ['leve', 'caminhonete', 'pickup', 'pick-up', 'picape', 'sedan', 'hatch', 'suv', 'passeio'] },
  { icone: 'utilitario', termos: ['utilitario', 'furgao', 'van', 'sprinter', 'ducato', 'master'] },
  { icone: 'onibus', termos: ['onibus', 'micro', 'coletivo'] },
  { icone: 'caminhao', termos: ['munck', 'caminhao', 'basculante', 'prancha', 'carroceria', 'pipa', 'comboio', 'cavalo', 'carreta', 'truck', 'toco', 'bau'] },
  { icone: 'guindaste', termos: ['guindaste', 'guindauto', 'plataforma', 'elevatoria', 'empilhadeira', 'manipulador'] },
  { icone: 'maquina', termos: ['retro', 'escavadeira', 'trator', 'pa carregadeira', 'carregadeira', 'motoniveladora', 'rolo', 'compactador', 'mini', 'bobcat'] },
];

export function familiaDaCategoria(categoria) {
  const texto = normalizar(categoria);
  const indice = FAMILIAS.findIndex((familia) => familia.termos.some((termo) => texto.includes(termo)));
  return indice < 0 ? { ordem: FAMILIAS.length, icone: 'outro' } : { ordem: indice, icone: FAMILIAS[indice].icone };
}

export function categoriaDo(equipamento) {
  return String(equipamento?.modelo || '').trim() || SEM_CATEGORIA;
}

/**
 * Agrupa e ordena: família operacional → quantidade (desc) → nome.
 * Dentro do bloco: frota própria antes de terceiros, depois TAG.
 * @returns {{ nome: string, icone: string, itens: object[] }[]}
 */
export function agruparPorCategoria(equipamentos) {
  const mapa = new Map();
  for (const equipamento of equipamentos) {
    const nome = categoriaDo(equipamento);
    if (!mapa.has(nome)) mapa.set(nome, []);
    mapa.get(nome).push(equipamento);
  }
  return [...mapa.entries()]
    .map(([nome, itens]) => ({
      nome,
      ...familiaDaCategoria(nome),
      itens: [...itens].sort((a, b) =>
        Number(!!a.is_terceiro) - Number(!!b.is_terceiro) ||
        String(a.tag).localeCompare(String(b.tag), 'pt-BR', { numeric: true })),
    }))
    .sort((a, b) =>
      Number(a.nome === SEM_CATEGORIA) - Number(b.nome === SEM_CATEGORIA) ||
      a.ordem - b.ordem ||
      b.itens.length - a.itens.length ||
      a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(({ ordem, ...grupo }) => grupo);
}

// Paleta curada sem vermelho (vermelho lê como alerta na reunião); vizinhos na
// lista sempre bem afastados no círculo de cores.
const PALETA_OBRAS = [210, 145, 275, 38, 320, 180, 95, 250, 60, 300];

// Matiz por obra: mesma obra = mesma cor em todas as linhas. A cor vem da posição
// na lista ordenada por nome (um hash do id colidia com frequência). Com mais de
// 10 obras a paleta se repete.
export function matizesDasObras(obras) {
  const ordenadas = [...obras].sort((a, b) =>
    String(a.nome).localeCompare(String(b.nome), 'pt-BR') || String(a.id).localeCompare(String(b.id)));
  return new Map(ordenadas.map((obra, indice) => [obra.id, PALETA_OBRAS[indice % PALETA_OBRAS.length]]));
}
