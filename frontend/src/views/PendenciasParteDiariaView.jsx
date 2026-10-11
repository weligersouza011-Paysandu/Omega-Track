import { useMemo, useState } from 'react';
import { Users, Calendar, AlertCircle, MessageSquare, Filter, Search, ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock, Send } from 'lucide-react';
import StatCard from '../components/StatCard.jsx';
import BadgeStatus from '../components/BadgeStatus.jsx';
import { partesDiarias, veiculos } from '../data/mockData.js';

export default function PendenciasParteDiariaView() {
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState({});

  const pendentes = useMemo(() => partesDiarias.filter(p => p.status_assinatura === 'PENDENTE'), []);
  const assinadasHoje = useMemo(() => partesDiarias.filter(p => p.status_assinatura === 'ASSINADO').length, []);

  const grupos = useMemo(() => {
    const map = new Map();
    pendentes.forEach(p => {
      if (!map.has(p.lideranca)) map.set(p.lideranca, []);
      map.get(p.lideranca).push(p);
    });
    const q = busca.trim().toUpperCase();
    return Array.from(map.entries())
      .filter(([lider, itens]) => {
        if (!q) return true;
        if (lider.toUpperCase().includes(q)) return true;
        return itens.some(i =>
          i.tag.toUpperCase().includes(q) || i.placa.toUpperCase().includes(q) ||
          i.funcionario.toUpperCase().includes(q) || i.obra.toUpperCase().includes(q)
        );
      })
      .map(([lider, itens]) => ({
        lider,
        itens: itens.sort((a, b) => new Date(a.data) - new Date(b.data)),
        total: itens.length,
      }))
      .sort((a, b) => b.total - a.total);
  }, [pendentes, busca]);

  const semana = useMemo(() => {
    const dias = [];
    const hoje = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoje); d.setDate(hoje.getDate() - i);
      dias.push({
        iso: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' }).replace('-feira', ''),
        diaSemana: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('-feira', ''),
      });
    }
    return dias;
  }, []);

  const calendarioPorVeiculo = useMemo(() => {
    const porTag = {};
    veiculos.filter(v => v.status === 'Mobilizado').slice(0, 6).forEach(v => {
      porTag[v.tag] = { placa: v.placa, dias: {} };
      semana.forEach(d => {
        const tem = Math.random() > 0.25;
        const aderente = tem && Math.random() > 0.15;
        porTag[v.tag].dias[d.iso] = tem ? (aderente ? 'ok' : 'baixa') : 'falta';
      });
    });
    return porTag;
  }, [semana]);

  const toggle = (k) => setExpandido(prev => ({ ...prev, [k]: !prev[k] }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Gestao de Cobranca</div>
          <h1 className="mt-1 text-2xl font-extrabold text-omega-900 tracking-tight sm:text-3xl">Pendencias de Parte Diaria</h1>
          <p className="mt-1 text-sm text-omega-500">
            Acompanhe as Partes Diarias pendentes de assinatura agrupadas por lideranca responsavel.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary"><Filter size={16} /> Filtros</button>
          <button className="btn-primary"><Send size={16} /> Cobrar Todos</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Pendentes Hoje" value={pendentes.length} icon={AlertCircle} iconBg="bg-status-amarelo" sub="Aguardando assinatura Synapse" />
        <StatCard title="Liderancas com Pendencia" value={grupos.length} icon={Users} iconBg="bg-omega-900" sub="Encarregados a contactar" />
        <StatCard title="Assinadas Hoje" value={assinadasHoje} icon={CheckCircle2} iconBg="bg-status-verde" sub="Aprovadas pelo planejamento" />
        <StatCard title="Taxa de Conformidade" value="92%" icon={Calendar} iconBg="bg-omega-accent" trend={4.2} trendLabel="vs. semana passada" />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-omega-900">Calendario de Lancamento — Ultimos 7 dias</h3>
            <p className="text-xs text-omega-500">Visao por veiculo: verde = lancado OK, amarelo = baixa aderencia, vermelho = sem lancamento</p>
          </div>
        </div>
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-omega-500 font-semibold border-b border-omega-100">
                <th className="py-2.5 pr-4 sticky left-0 bg-white z-10">TAG / Placa</th>
                {semana.map(d => (
                  <th key={d.iso} className="py-2.5 px-2 text-center whitespace-nowrap">{d.diaSemana}<div className="text-[10px] text-omega-400 mt-0.5">{d.label.split(' ')[1]}</div></th>
                ))}
                <th className="py-2.5 pl-4 text-right">Semana</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-omega-100">
              {Object.entries(calendarioPorVeiculo).map(([tag, info]) => {
                const valores = Object.values(info.dias);
                const ok = valores.filter(v => v === 'ok').length;
                const falta = valores.filter(v => v === 'falta').length;
                return (
                  <tr key={tag} className="hover:bg-omega-50">
                    <td className="py-3 pr-4 sticky left-0 bg-white">
                      <div className="font-bold text-omega-900">{tag}</div>
                      <div className="text-xs text-omega-500 font-mono">{info.placa}</div>
                    </td>
                    {semana.map(d => {
                      const status = info.dias[d.iso];
                      const cfg = {
                        ok: { bg: 'bg-green-50', dot: 'bg-status-verde', icon: CheckCircle2, txt: 'text-status-verde', label: 'OK' },
                        baixa: { bg: 'bg-amber-50', dot: 'bg-status-amarelo', icon: Clock, txt: 'text-status-amarelo', label: 'Baixa aderencia' },
                        falta: { bg: 'bg-red-50', dot: 'bg-status-vermelho', icon: XCircle, txt: 'text-status-vermelho', label: 'Sem lancamento' },
                      }[status];
                      return (
                        <td key={d.iso} className="py-3 px-2">
                          <div className={`w-full h-10 rounded-lg ${cfg.bg} border border-black/5 flex items-center justify-center ${cfg.txt}`} title={cfg.label}>
                            <cfg.icon size={16} />
                          </div>
                        </td>
                      );
                    })}
                    <td className="py-3 pl-4 text-right">
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-omega-100 text-xs font-bold text-omega-700">
                        {ok}/{valores.length} dias
                        {falta > 0 && <span className="text-status-vermelho ml-1">({falta} faltas)</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="p-4 border-b border-omega-100 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <h3 className="font-bold text-omega-900">Partes Diarias Pendentes por Lideranca</h3>
          <div className="relative sm:max-w-sm flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
            <input value={busca} onChange={e => setBusca(e.target.value)} className="input pl-9" placeholder="Buscar lider, TAG, placa ou obra..." />
          </div>
        </div>

        <div className="divide-y divide-omega-100">
          {grupos.length === 0 && (
            <div className="p-10 text-center text-omega-500">Nenhuma pendencia encontrada.</div>
          )}
          {grupos.map(g => {
            const aberto = expandido[g.lider] ?? true;
            return (
              <div key={g.lider}>
                <button
                  onClick={() => toggle(g.lider)}
                  className="w-full p-4 flex items-center gap-4 hover:bg-omega-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200/60 flex items-center justify-center shrink-0">
                      <Users className="text-status-vermelho" size={20} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-status-vermelho font-extrabold text-lg leading-none">{g.lider}</span>
                        <span className="chip bg-status-vermelho text-white">{g.total} pendente{g.total > 1 ? 's' : ''}</span>
                      </div>
                      <p className="text-xs text-omega-500 mt-1">
                        Encarregado(a) — {g.itens.map(i => i.tag).filter((v, idx, arr) => arr.indexOf(v) === idx).join(', ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="btn-secondary !py-1.5 !px-3 text-xs"
                    >
                      <MessageSquare size={14} /> Cobrar
                    </button>
                    {aberto ? <ChevronDown size={20} className="text-omega-500" /> : <ChevronRight size={20} className="text-omega-500" />}
                  </div>
                </button>

                {aberto && (
                  <div className="bg-omega-50/70 border-t border-omega-100 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-semibold border-b border-omega-200">
                          <th className="py-2.5 pl-6 pr-4">TAG / Placa</th>
                          <th className="py-2.5 pr-4">Funcionario</th>
                          <th className="py-2.5 pr-4">Data</th>
                          <th className="py-2.5 pr-4">Obra</th>
                          <th className="py-2.5 pr-4">Status</th>
                          <th className="py-2.5 pr-6 text-right">Assinatura</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-omega-200/60">
                        {g.itens.map(i => (
                          <tr key={i.id} className="hover:bg-white">
                            <td className="py-3 pl-6 pr-4">
                              <div className="font-bold text-omega-900">{i.tag}</div>
                              <div className="text-xs text-omega-500 font-mono">{i.placa}</div>
                            </td>
                            <td className="py-3 pr-4">
                              <div className="text-omega-800 font-medium">{i.funcionario}</div>
                              <div className="text-xs text-omega-500">{i.funcao}</div>
                            </td>
                            <td className="py-3 pr-4 tabular-nums text-omega-700">{new Date(i.data).toLocaleDateString('pt-BR')}</td>
                            <td className="py-3 pr-4">
                              <div className="text-omega-800 font-medium">{i.obra}</div>
                              {i.obra !== i.obra_programada && (
                                <div className="text-[11px] text-status-amarelo font-semibold mt-0.5">
                                  Programada: {i.obra_programada}
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-4"><BadgeStatus status={i.status} /></td>
                            <td className="py-3 pr-6 text-right">
                              <BadgeStatus status={i.status_assinatura} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
