import { useMemo, useState } from 'react';
import { Gauge, AlertTriangle, Search, Download, MapPin, Clock, Zap, Radio, Truck, TrendingDown } from 'lucide-react';
import StatCard from '../components/StatCard.jsx';
import BadgeStatus from '../components/BadgeStatus.jsx';
import { eventosTelemetria } from '../data/mockData.js';

const TIPOS = ['Todos', 'Excesso de Velocidade', 'Arrancada Brusca', 'Freada de Emergencia', 'Fadiga / Sono', 'Uso de Celular'];

export default function TelemetriaView() {
  const [busca, setBusca] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('Todos');
  const [filtroSeveridade, setFiltroSeveridade] = useState('todas');

  const totalEventos = eventosTelemetria.length;
  const gravissimos = eventosTelemetria.filter(e => e.severidade === 'Alta').length;
  const fadiga = eventosTelemetria.filter(e => e.tipo === 'Fadiga / Sono').length;
  const velocidade = eventosTelemetria.filter(e => e.tipo === 'Excesso de Velocidade').length;
  const semDados = totalEventos === 0;

  const topInfratores = useMemo(() => {
    const mapa = {};
    eventosTelemetria.forEach(e => {
      if (!mapa[e.tag]) mapa[e.tag] = { tag: e.tag, placa: e.placa, total: 0, graves: 0 };
      mapa[e.tag].total++;
      if (e.severidade === 'Alta') mapa[e.tag].graves++;
    });
    return Object.values(mapa).sort((a, b) => b.graves - a.graves || b.total - a.total).slice(0, 5);
  }, []);

  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return eventosTelemetria.filter(e => {
      if (filtroTipo !== 'Todos' && e.tipo !== filtroTipo) return false;
      if (filtroSeveridade !== 'todas' && e.severidade.toLowerCase() !== filtroSeveridade) return false;
      if (!q) return true;
      return (
        e.tag.toUpperCase().includes(q) ||
        e.placa.toUpperCase().includes(q) ||
        e.tipo.toUpperCase().includes(q) ||
        (e.localizacao || '').toUpperCase().includes(q)
      );
    }).sort((a, b) => new Date(b.data_hora.replace(' ', 'T')) - new Date(a.data_hora.replace(' ', 'T')));
  }, [busca, filtroTipo, filtroSeveridade]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Seguranca & Comportamento</div>
          <h1 className="mt-1 text-2xl font-extrabold text-omega-900 tracking-tight sm:text-3xl">Telemetria & Fadiga</h1>
          <p className="mt-1 text-sm text-omega-500">
            Eventos de telemetria cruzados automaticamente com a TAG pela placa do veiculo.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary"><Download size={16} /> Exportar CSV</button>
          <button className="btn-primary"><Radio size={16} /> Abrir Tracker</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total de Eventos (24h)" value={totalEventos} icon={Gauge} iconBg="bg-omega-900" sub="Todos os veiculos monitorados" trend={-12} trendLabel="melhoria" />
        <StatCard title="Infracoes Graves" value={gravissimos} icon={AlertTriangle} iconBg="bg-status-vermelho" sub="Alta severidade, requer intervencao" trend={-8} />
        <StatCard title="Casos de Fadiga" value={fadiga} icon={Clock} iconBg="bg-status-amarelo" sub="Parada obrigatoria excedida" />
        <StatCard title="Excesso de Velocidade" value={velocidade} icon={Zap} iconBg="bg-omega-accent" sub="Acima do limite da via" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-2 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between">
            <h3 className="font-bold text-omega-900">Historico de Eventos</h3>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <div className="relative sm:max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
                <input value={busca} onChange={e => setBusca(e.target.value)} className="input pl-9" placeholder="TAG, placa ou local..." />
              </div>
              <select value={filtroSeveridade} onChange={e => setFiltroSeveridade(e.target.value)} className="input sm:max-w-[160px]">
                <option value="todas">Todas severidades</option>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baixa">Baixa</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1">
            {TIPOS.map(t => (
              <button
                key={t}
                onClick={() => setFiltroTipo(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                  filtroTipo === t ? 'bg-omega-900 text-white' : 'bg-omega-100 text-omega-700 hover:bg-omega-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-omega-50 text-left text-xs uppercase tracking-wider text-omega-500 font-semibold">
                <tr>
                  <th className="py-3 pr-4 rounded-tl-xl">Data / Hora</th>
                  <th className="py-3 pr-4">TAG x Placa</th>
                  <th className="py-3 pr-4">Evento</th>
                  <th className="py-3 pr-4">Valor / Limite</th>
                  <th className="py-3 pr-4">Localizacao</th>
                  <th className="py-3 rounded-tr-xl text-right">Severidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-omega-100">
                {filtrados.map(e => (
                  <tr key={e.id} className="hover:bg-omega-50">
                    <td className="py-3 pr-4 whitespace-nowrap tabular-nums text-omega-700">
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} className="text-omega-400" />
                        {e.data_hora}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-omega-100 flex items-center justify-center text-omega-700 shrink-0">
                          <Truck size={14} />
                        </div>
                        <div>
                          <div className="font-bold text-omega-900 leading-tight">{e.tag}</div>
                          <div className="text-[11px] text-omega-500 font-mono leading-tight">{e.placa}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-omega-800">{e.tipo}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="tabular-nums">
                        <span className="text-status-vermelho font-semibold">{e.valor}</span>
                        <span className="text-omega-400 mx-1">/</span>
                        <span className="text-omega-500">{e.limite}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-start gap-1.5 text-omega-600 max-w-[280px]">
                        <MapPin size={12} className="mt-1 shrink-0 text-omega-400" />
                        <span className="text-xs leading-snug">{e.localizacao}</span>
                      </div>
                    </td>
                    <td className="py-3 text-right"><BadgeStatus status={e.severidade} /></td>
                  </tr>
                ))}
                {filtrados.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-omega-500">Nenhum evento encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-omega-900">Top 5 — Mais Infracoes</h3>
              <TrendingDown size={18} className="text-status-vermelho" />
            </div>
            <ul className="space-y-3">
              {topInfratores.map((veic, idx) => (
                <li key={veic.tag} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-omega-900 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <span className="font-bold text-omega-900 text-sm">{veic.tag}</span>
                        <span className="ml-2 text-[11px] font-mono text-omega-500">{veic.placa}</span>
                      </div>
                      <div className="text-sm font-extrabold text-omega-900 tabular-nums shrink-0">
                        {veic.total}
                      </div>
                    </div>
                    <div className="w-full h-2 rounded-full bg-omega-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${veic.graves >= 2 ? 'bg-status-vermelho' : veic.graves >= 1 ? 'bg-status-amarelo' : 'bg-omega-accent'}`}
                        style={{ width: `${Math.min(100, (veic.total / 5) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-omega-500 flex items-center justify-between">
                      <span className="font-semibold text-status-vermelho">{veic.graves} grave(s)</span>
                      <span>{veic.total - veic.graves} outras</span>
                    </div>
                  </div>
                </li>
              ))}
              {topInfratores.length === 0 && (
                <li className="rounded-xl border border-dashed border-omega-200 p-4 text-center text-sm text-omega-500">
                  Nenhuma ocorrencia registrada ate o momento.
                </li>
              )}
            </ul>
          </div>

          <div className="card p-5 bg-gradient-to-br from-omega-900 to-omega-800 text-white">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-status-amarelo" />
              <h3 className="font-bold">Alerta de Risco — Hoje</h3>
            </div>
            {semDados ? (
              <p className="text-sm text-omega-300 leading-relaxed">
                Nenhum alerta ativo no momento. Esta area sera preenchida quando a telemetria real comecar a chegar.
              </p>
            ) : (
              <>
                <p className="text-sm text-omega-300 leading-relaxed">
                  Existem eventos de telemetria que exigem acompanhamento da operacao.
                </p>
                <button className="mt-4 w-full bg-status-vermelho hover:bg-red-600 text-white rounded-lg py-2 text-sm font-semibold flex items-center justify-center gap-2">
                  <Radio size={14} /> Acionar supervisor
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
