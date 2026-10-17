const STATUS_MAP = {
  // Status Operacional do Veículo/Equipamento (paleta distinta por tipo)
  'Operação': { bg: 'bg-blue-100', text: 'text-blue-800', ring: 'ring-blue-600/25', label: 'Operação' },
  'Manutenção Preventiva': { bg: 'bg-amber-100', text: 'text-amber-800', ring: 'ring-amber-600/25', label: 'Manutenção Preventiva' },
  'Manutenção Corretiva': { bg: 'bg-red-100', text: 'text-red-800', ring: 'ring-red-600/25', label: 'Manutenção Corretiva' },
  'Indisponibilidade': { bg: 'bg-purple-100', text: 'text-purple-800', ring: 'ring-purple-600/25', label: 'Indisponibilidade' },
  'Interdição': { bg: 'bg-slate-800', text: 'text-slate-100', ring: 'ring-slate-900', label: 'Interdição' },

  // Status do Fluxo de Aprovação do Relatório
  'Em Preenchimento': { bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-600/20', label: 'Em Preenchimento' },
  'Finalizado pelo Operador': { bg: 'bg-amber-50', text: 'text-amber-800', ring: 'ring-amber-600/30', label: 'Finalizado pelo Operador' },
  'Revisado pelo Transporte': { bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-600/30', label: 'Revisado pelo Transporte' },
  'Aprovado': { bg: 'bg-green-50', text: 'text-status-verde', ring: 'ring-green-600/20', label: 'Aprovado' },

  Mobilizado: { bg: 'bg-green-50', text: 'text-status-verde', ring: 'ring-green-600/20', label: 'Mobilizado' },
  Desmobilizado: { bg: 'bg-omega-100', text: 'text-omega-700', ring: 'ring-omega-700/20', label: 'Desmobilizado' },
  'Em Manutencao': { bg: 'bg-amber-50', text: 'text-status-amarelo', ring: 'ring-amber-600/20', label: 'Em Manutenção' },
  Interditado: { bg: 'bg-red-50', text: 'text-status-vermelho', ring: 'ring-red-600/20', label: 'Interditado' },
  Operacional: { bg: 'bg-green-50', text: 'text-status-verde', ring: 'ring-green-600/20', label: 'Operacional' },
  ASSINADO: { bg: 'bg-green-50', text: 'text-status-verde', ring: 'ring-green-600/20', label: 'Assinado' },
  PENDENTE: { bg: 'bg-amber-50', text: 'text-status-amarelo', ring: 'ring-amber-600/20', label: 'Pendente' },
  VERDE: { bg: 'bg-green-50', text: 'text-status-verde', ring: 'ring-green-600/20', label: 'Em Dia' },
  AMARELO: { bg: 'bg-amber-50', text: 'text-status-amarelo', ring: 'ring-amber-600/20', label: 'Atenção' },
  VERMELHO: { bg: 'bg-red-50', text: 'text-status-vermelho', ring: 'ring-red-600/20', label: 'Vencido' },
  Alta: { bg: 'bg-red-50', text: 'text-status-vermelho', ring: 'ring-red-600/20', label: 'Alta' },
  Media: { bg: 'bg-amber-50', text: 'text-status-amarelo', ring: 'ring-amber-600/20', label: 'Média' },
  Baixa: { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-600/20', label: 'Baixa' },
  PREENCHENDO: { bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-600/20', label: 'Em Preenchimento' },
  REVISAO: { bg: 'bg-amber-50', text: 'text-status-amarelo', ring: 'ring-amber-600/20', label: 'Em Revisão' },
};

export default function BadgeStatus({ status, dot = true }) {
  const cfg = STATUS_MAP[status] || STATUS_MAP['Operacional'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold ring-1 ring-inset ${cfg.bg} ${cfg.text} ${cfg.ring}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${cfg.text.replace('text-', 'bg-')}`} />}
      {cfg.label}
    </span>
  );
}
