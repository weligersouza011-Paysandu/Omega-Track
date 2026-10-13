// Estados do farol de vencimentos (compartilhado: Documentação + Dashboard).
//   EMDIA        > 30 dias (verde)
//   PLANEJAMENTO 16–30 dias (roxo)
//   ATENCAO      6–15 dias (laranja)
//   CRITICO      0–5 dias (azul escuro)
//   VENCIDO      < hoje (rosa/vermelho)

export const FAROL_LABEL = {
  EMDIA: 'Em Dia (>30 dias)',
  PLANEJAMENTO: 'Planejamento (16-30 dias)',
  ATENCAO: 'Atencao (6-15 dias)',
  CRITICO: 'Critico (0-5 dias)',
  VENCIDO: 'Vencido',
};

export const FAROL_LABEL_CURTO = {
  EMDIA: 'Em Dia',
  PLANEJAMENTO: 'Planejamento',
  ATENCAO: 'Atenção',
  CRITICO: 'Crítico',
  VENCIDO: 'Vencido',
};

export const FAROL_COR = {
  EMDIA: '#16A34A',
  PLANEJAMENTO: '#581C87',
  ATENCAO: '#F97316',
  CRITICO: '#1D4ED8',
  VENCIDO: '#DC2626',
};

export const ORDEM_FAROL = ['EMDIA', 'PLANEJAMENTO', 'ATENCAO', 'CRITICO', 'VENCIDO'];

export function calcularFarol(validade) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const v = new Date(validade);
  v.setHours(0, 0, 0, 0);
  const dias = Math.ceil((v - hoje) / 86400000);
  if (dias < 0) return { farol: 'VENCIDO', dias };
  if (dias <= 5) return { farol: 'CRITICO', dias };
  if (dias <= 15) return { farol: 'ATENCAO', dias };
  if (dias <= 30) return { farol: 'PLANEJAMENTO', dias };
  return { farol: 'EMDIA', dias };
}

export function textoDias(dias) {
  if (dias < 0) return `Vencido há ${Math.abs(dias)} dia(s)`;
  if (dias === 0) return 'Vence hoje';
  return `Faltam ${dias} dia(s)`;
}
