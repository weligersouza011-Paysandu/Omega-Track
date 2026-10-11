const STATUS_MAP = {
  Mobilizado: { bg: 'bg-green-50', text: 'text-status-verde', ring: 'ring-green-600/20', label: 'Mobilizado' },
  Desmobilizado: { bg: 'bg-omega-100', text: 'text-omega-700', ring: 'ring-omega-700/20', label: 'Desmobilizado' },
  'Em Manutencao': { bg: 'bg-amber-50', text: 'text-status-amarelo', ring: 'ring-amber-600/20', label: 'Em Manutencao' },
  Interditado: { bg: 'bg-red-50', text: 'text-status-vermelho', ring: 'ring-red-600/20', label: 'Interditado' },
  Operacional: { bg: 'bg-green-50', text: 'text-status-verde', ring: 'ring-green-600/20', label: 'Operacional' },
  ASSINADO: { bg: 'bg-green-50', text: 'text-status-verde', ring: 'ring-green-600/20', label: 'Assinado' },
  PENDENTE: { bg: 'bg-amber-50', text: 'text-status-amarelo', ring: 'ring-amber-600/20', label: 'Pendente' },
  VERDE: { bg: 'bg-green-50', text: 'text-status-verde', ring: 'ring-green-600/20', label: 'Em Dia' },
  AMARELO: { bg: 'bg-amber-50', text: 'text-status-amarelo', ring: 'ring-amber-600/20', label: 'Atencao' },
  VERMELHO: { bg: 'bg-red-50', text: 'text-status-vermelho', ring: 'ring-red-600/20', label: 'Vencido' },
  Alta: { bg: 'bg-red-50', text: 'text-status-vermelho', ring: 'ring-red-600/20', label: 'Alta' },
  Media: { bg: 'bg-amber-50', text: 'text-status-amarelo', ring: 'ring-amber-600/20', label: 'Media' },
  Baixa: { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-600/20', label: 'Baixa' },
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
