import { Link } from 'react-router-dom';
import { Truck, FileCheck, ClipboardCheck, Gauge, ArrowUpRight, ChevronRight, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import StatCard from '../components/StatCard.jsx';
import BadgeStatus from '../components/BadgeStatus.jsx';
import { veiculos, documentos, partesDiarias, eventosTelemetria } from '../data/mockData.js';

function calcularFarol(validade) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const v = new Date(validade); v.setHours(0, 0, 0, 0);
  const dias = Math.ceil((v - hoje) / 86400000);
  if (dias < 0) return 'VERMELHO';
  if (dias < 15) return 'AMARELO';
  return 'VERDE';
}

const FAROL_CLASS = {
  VERDE: {
    card: 'rounded-xl border border-status-verde/20 bg-status-verde/5 p-4',
    iconWrap: 'w-8 h-8 rounded-lg bg-status-verde/15 flex items-center justify-center text-status-verde',
    value: 'text-3xl font-extrabold text-status-verde tabular-nums',
  },
  AMARELO: {
    card: 'rounded-xl border border-status-amarelo/20 bg-status-amarelo/5 p-4',
    iconWrap: 'w-8 h-8 rounded-lg bg-status-amarelo/15 flex items-center justify-center text-status-amarelo',
    value: 'text-3xl font-extrabold text-status-amarelo tabular-nums',
  },
  VERMELHO: {
    card: 'rounded-xl border border-status-vermelho/20 bg-status-vermelho/5 p-4',
    iconWrap: 'w-8 h-8 rounded-lg bg-status-vermelho/15 flex items-center justify-center text-status-vermelho',
    value: 'text-3xl font-extrabold text-status-vermelho tabular-nums',
  },
};

export default function DashboardView() {
  const totalFrota = veiculos.length;
  const frotaMobilizada = veiculos.filter(v => v.status === 'Mobilizado').length;
  const efetividade = totalFrota ? Math.round((frotaMobilizada / totalFrota) * 100) : 0;
  const semDados = totalFrota === 0;

  const docsPorStatus = { VERMELHO: 0, AMARELO: 0, VERDE: 0 };
  documentos.forEach(d => { docsPorStatus[calcularFarol(d.validade)]++; });

  const partesPendentes = partesDiarias.filter(p => p.status_assinatura === 'PENDENTE');
  const ultimasPendentes = partesPendentes.slice(0, 5);

  const infracoesAlta = eventosTelemetria.filter(e => e.severidade === 'Alta').length;

  const farolCards = [
    { k: 'VERDE', label: 'Em Dia', val: docsPorStatus.VERDE, i: CheckCircle2 },
    { k: 'AMARELO', label: 'Atencao (<15d)', val: docsPorStatus.AMARELO, i: Clock },
    { k: 'VERMELHO', label: 'Vencidos', val: docsPorStatus.VERMELHO, i: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Painel Executivo</div>
          <h1 className="mt-1 text-2xl font-extrabold text-omega-900 tracking-tight sm:text-3xl">
            Visao Geral da Operacao
          </h1>
          <p className="mt-1 text-sm text-omega-500">
            Indicadores em tempo real da frota, documentacao, partes diarias e eventos de telemetria.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary">Exportar relatorio</button>
          <button className="btn-primary"><ArrowUpRight size={16} /> Power BI</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Frota Mobilizada" value={`${frotaMobilizada}/${totalFrota}`} sub={`${efetividade}% de efetividade`} icon={Truck} iconBg="bg-omega-900" trend={3.2} trendLabel="vs. semana anterior" />
        <StatCard title="Docs. Criticos" value={docsPorStatus.VERMELHO + docsPorStatus.AMARELO} sub={`${docsPorStatus.VERMELHO} vencidos • ${docsPorStatus.AMARELO} em 15 dias`} icon={FileCheck} iconBg="bg-status-vermelho" trend={-12} trendLabel="melhoria" />
        <StatCard title="Pendentes Assinatura" value={partesPendentes.length} sub="Partes diarias aguardando Synapse" icon={ClipboardCheck} iconBg="bg-status-amarelo" trend={8.1} trendLabel="aumento" />
        <StatCard title="Infracoes Graves (24h)" value={infracoesAlta} sub={`Total eventos: ${eventosTelemetria.length}`} icon={Gauge} iconBg="bg-omega-accent" trend={-20} trendLabel="reducao" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-omega-900">Farol de Documentos</h3>
              <p className="text-xs text-omega-500">Status de validade da documentacao da frota</p>
            </div>
            <Link to="/farol-documentos" className="text-sm font-semibold text-omega-accent hover:underline inline-flex items-center gap-1">
              Ver detalhes <ChevronRight size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {farolCards.map(item => {
              const cls = FAROL_CLASS[item.k];
              return (
                <div key={item.k} className={cls.card}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={cls.iconWrap}>
                      <item.i size={16} />
                    </div>
                    <span className="text-xs font-semibold text-omega-600 uppercase tracking-wide">{item.label}</span>
                  </div>
                  <div className={cls.value}>{item.val}</div>
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-omega-100 text-left text-xs uppercase tracking-wider text-omega-500 font-semibold">
                  <th className="py-2.5 pr-4">TAG / Placa</th>
                  <th className="py-2.5 pr-4">Documento</th>
                  <th className="py-2.5 pr-4">Validade</th>
                  <th className="py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-omega-100">
                {documentos.slice(0, 6).map(d => (
                  <tr key={d.id} className="hover:bg-omega-50">
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-omega-900">{d.tag}</div>
                      <div className="text-xs text-omega-500">{d.placa}</div>
                    </td>
                    <td className="py-3 pr-4 text-omega-700">{d.documento}</td>
                    <td className="py-3 pr-4 tabular-nums text-omega-700">
                      {new Date(d.validade).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="py-3 text-right"><BadgeStatus status={calcularFarol(d.validade)} /></td>
                  </tr>
                ))}
                {documentos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-omega-500">
                      Nenhum documento disponivel para exibicao.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-omega-900">Partes Diarias Pendentes</h3>
              <p className="text-xs text-omega-500">Aguardando aprovacao Synapse</p>
            </div>
            <Link to="/pendencias-parte-diaria" className="text-sm font-semibold text-omega-accent hover:underline inline-flex items-center gap-1">
              Cobrar <ChevronRight size={14} />
            </Link>
          </div>
          <ul className="space-y-3">
            {ultimasPendentes.map(p => (
              <li key={p.id} className="rounded-xl border border-omega-100 p-3 hover:bg-omega-50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-omega-900">{p.tag}</span>
                      <span className="text-[11px] font-mono text-omega-500">{p.placa}</span>
                    </div>
                    <div className="text-sm text-omega-700 truncate">{p.funcionario} • <span className="text-omega-500">{p.funcao}</span></div>
                    <div className="text-xs text-omega-500 mt-0.5">{new Date(p.data).toLocaleDateString('pt-BR')} • {p.lideranca}</div>
                  </div>
                  <BadgeStatus status={p.status_assinatura} />
                </div>
              </li>
            ))}
            {ultimasPendentes.length === 0 && (
              <li className="rounded-xl border border-dashed border-omega-200 p-4 text-center text-sm text-omega-500">
                Nenhuma parte diaria pendente no momento.
              </li>
            )}
          </ul>

          <div className="mt-5 pt-5 border-t border-omega-100">
            <div className="space-y-2">
              {['Carlos Mendes', 'Ana Paula', 'Roberto Alves'].map(nome => {
                const total = partesPendentes.filter(p => p.lideranca === nome).length;
                if (total === 0) return null;
                return (
                  <div key={nome} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-status-vermelho" />
                      <span className="text-omega-700 truncate">{nome}</span>
                    </div>
                    <span className="font-bold tabular-nums text-status-vermelho">{total} pend.</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {semDados && (
        <div className="card p-5 text-sm text-omega-500">
          O painel principal esta limpo e pronto para receber os dados reais da operacao.
        </div>
      )}
    </div>
  );
}
