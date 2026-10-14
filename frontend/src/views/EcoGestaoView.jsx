import { Sprout, Gauge, Award, TrendingDown } from 'lucide-react';

const PLACEHOLDERS = [
  { icon: Gauge, titulo: 'Score Eco de Condução', desc: 'Ranking de motoristas por condução eficiente.' },
  { icon: TrendingDown, titulo: 'Redução de Emissões', desc: 'Evolução mensal de CO₂ da frota.' },
  { icon: Award, titulo: 'Metas & Certificações', desc: 'Metas verdes e selos ambientais.' },
];

export default function EcoGestaoView() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Meio Ambiente</div>
          <h1 className="mt-1 text-2xl font-extrabold text-omega-900 tracking-tight sm:text-3xl">
            EcoGestão
          </h1>
          <p className="mt-1 text-sm text-omega-500">
            Gestão ecológica da frota — eficiência, metas verdes e condução sustentável.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLACEHOLDERS.map((c) => (
          <div key={c.titulo} className="card p-5 border-t-[3px] !border-t-emerald-500">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-600 mb-3">
              <c.icon size={18} />
            </div>
            <div className="text-sm font-extrabold text-omega-900">{c.titulo}</div>
            <div className="text-xs text-omega-500 mt-1">{c.desc}</div>
            <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold">
              <Sprout size={12} /> Em breve
            </div>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <div className="text-sm font-extrabold text-omega-900 mb-1">Painel de indicadores</div>
        <div className="text-xs text-omega-500">
          Espaço reservado para os gráficos e relatórios da EcoGestão.
        </div>
      </div>
    </div>
  );
}
