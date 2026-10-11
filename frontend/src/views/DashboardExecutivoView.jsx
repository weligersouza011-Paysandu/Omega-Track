import { useMemo } from 'react';
import { Calendar, ExternalLink, AlertTriangle, Clock, CheckCircle2, FileWarning } from 'lucide-react';
import { veiculos, documentos } from '../data/mockData.js';

function calcularFarol(validade) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const v = new Date(validade); v.setHours(0, 0, 0, 0);
  const dias = Math.ceil((v - hoje) / 86400000);
  if (dias < 0) return 'VENCIDO';
  if (dias <= 1) return 'CRITICO';
  if (dias <= 15) return 'ATENCAO';
  if (dias <= 30) return 'PLANEJAMENTO';
  return 'EMDIA';
}

const FAROL_LABEL = {
  EMDIA: 'Em Dia (>30 dias)',
  ATENCAO: 'Atencao (6-15 dias)',
  CRITICO: 'Critico (1-5 dias)',
  PLANEJAMENTO: 'Planejamento (16-30 dias)',
  VENCIDO: 'Vencido',
};

const FAROL_COR = {
  EMDIA: '#2563EB',
  ATENCAO: '#F97316',
  CRITICO: '#1E40AF',
  PLANEJAMENTO: '#581C87',
  VENCIDO: '#EC4899',
};

const CONTRATOS = ['Eletromecanica', 'Serra Leste', 'Sandagan'];
const MODELOS_ORDEM = ['Onibus', 'Caminhonete', 'Veiculo Leve', 'Caminhao Munck', 'Caminhao 3/4', 'VAN', 'Carreta Prancha', 'Gerador', 'PIPA'];

export default function DashboardExecutivoView() {
  const hoje = new Date();
  const dataStr = hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  const powerBiUrl = import.meta.env.VITE_POWER_BI_URL || '';
  const semDados = veiculos.length === 0;

  const mobPorContrato = useMemo(() => {
    const res = {};
    CONTRATOS.forEach(c => { res[c] = { mob: 0, desmob: 0 }; });
    veiculos.forEach(v => {
      const c = v.contrato || 'Eletromecanica';
      if (!res[c]) res[c] = { mob: 0, desmob: 0 };
      if (v.status === 'Mobilizado') res[c].mob++;
      else res[c].desmob++;
    });
    return res;
  }, []);

  const maxMobContrato = useMemo(() => {
    return Math.max(...Object.values(mobPorContrato).map(v => v.mob + v.desmob), 1);
  }, [mobPorContrato]);

  const modelosPorContrato = useMemo(() => {
    const res = {};
    MODELOS_ORDEM.forEach(m => {
      res[m] = {};
      CONTRATOS.forEach(c => { res[m][c] = { mob: 0, desmob: 0 }; });
    });
    veiculos.forEach(v => {
      const cat = v.categoria || v.modelo;
      const key = MODELOS_ORDEM.find(m => cat.toLowerCase().includes(m.toLowerCase())) || cat;
      const c = v.contrato || 'Eletromecanica';
      if (!res[key]) res[key] = {};
      if (!res[key][c]) res[key][c] = { mob: 0, desmob: 0 };
      if (v.status === 'Mobilizado') res[key][c].mob++;
      else res[key][c].desmob++;
    });
    return res;
  }, []);

  const maxModelo = useMemo(() => {
    let max = 0;
    Object.values(modelosPorContrato).forEach(contratos => {
      Object.values(contratos).forEach(v => {
        const total = v.mob + v.desmob;
        if (total > max) max = total;
      });
    });
    return Math.max(max, 1);
  }, [modelosPorContrato]);

  const docsPorFarol = useMemo(() => {
    const r = { EMDIA: 0, ATENCAO: 0, CRITICO: 0, PLANEJAMENTO: 0, VENCIDO: 0 };
    documentos.forEach(d => { r[calcularFarol(d.validade)]++; });
    return r;
  }, []);

  const maxFarol = Math.max(...Object.values(docsPorFarol), 1);

  const docsPorFarolPorModelo = useMemo(() => {
    const r = {};
    ['Caminhonete', 'Veiculo Leve'].forEach(m => {
      r[m] = { EMDIA: 0, ATENCAO: 0, CRITICO: 0, PLANEJAMENTO: 0, VENCIDO: 0 };
    });
    documentos.forEach(d => {
      const v = veiculos.find(vv => vv.tag === d.tag);
      if (!v) return;
      const cat = v.categoria || v.modelo;
      const key = cat.toLowerCase().includes('leve') ? 'Veiculo Leve' :
                  cat.toLowerCase().includes('caminhonete') ? 'Caminhonete' : null;
      if (!key || !r[key]) return;
      r[key][calcularFarol(d.validade)]++;
    });
    return r;
  }, []);

  const tagsRelevantes = ['JI212', 'JI291', 'JI467', 'JI510', 'JI281', 'JI444', 'JI536'];
  const docsPorFarolPorTag = useMemo(() => {
    const r = {};
    tagsRelevantes.forEach(t => { r[t] = { EMDIA: 0, ATENCAO: 0, CRITICO: 0, PLANEJAMENTO: 0, VENCIDO: 0 }; });
    documentos.forEach(d => {
      if (r[d.tag]) r[d.tag][calcularFarol(d.validade)]++;
    });
    return r;
  }, []);

  const farolMaxTag = useMemo(() => {
    let m = 0;
    Object.values(docsPorFarolPorTag).forEach(v => {
      const total = Object.values(v).reduce((a, b) => a + b, 0);
      if (total > m) m = total;
    });
    return Math.max(m, 1);
  }, [docsPorFarolPorTag]);

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-omega-200 shadow-card">
        <div className="absolute inset-0 bg-gradient-to-br from-omega-900 via-omega-800 to-omega-900" />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />
        <div className="relative px-6 pt-5 pb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-white/95 flex items-center justify-center shadow-lg">
                <span className="text-omega-900 font-black text-2xl">2</span>
              </div>
              <div>
                <div className="text-white/60 text-xs font-semibold uppercase tracking-wider">OMEGA SERVICE</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Calendar size={14} className="text-omega-accent" />
                  <span className="text-white font-medium capitalize text-sm">{dataStr}</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-white/60 text-[11px] font-semibold uppercase tracking-wider">Contrato</div>
              <div className="text-white font-black text-lg">CT251</div>
            </div>
          </div>
          <h1 className="text-white text-3xl sm:text-4xl font-black tracking-tight leading-tight text-center">
            DASHBOARD DE TRANSPORTE
          </h1>
          <h2 className="text-omega-accent text-2xl sm:text-3xl font-black tracking-tight text-center mt-1">
            OMEGA TRACK CT251
          </h2>
          <div className="mt-5 max-w-4xl mx-auto bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
            <div className="text-white/90 font-bold text-sm mb-1.5 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-omega-accent" />
              Controle de Mobilizacao, Desmobilizacao e Documentacao
            </div>
            <p className="text-white/70 text-xs leading-relaxed">
              O Dashboard de Mobilizacao e Desmobilizacao de Veiculos Integra o controle operacional da frota com o monitoramento de documentacoes,
              consolidando informacoes criticas em uma visao estrategica. Por meio de indicadores dinamicos, o sistema permite acompanhar o status dos veiculos
              do contrato e antecipar vencimentos de documentos obrigatorios. Com isso, a lideranca ganha suporte na tomada de decisoes, garantindo
              conformidade, evitando riscos operacionais e assegurando a continuidade das operacoes.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="card p-4 xl:col-span-1 overflow-hidden">
          <div className="text-[11px] font-semibold text-omega-500 uppercase tracking-wider mb-1">Controle</div>
          <div className="text-xs font-bold text-omega-700 mb-3">Modelo • TAG • PLACA • Status</div>
          <div className="overflow-y-auto max-h-[380px] pr-1 space-y-1">
            {semDados ? (
              <div className="rounded-xl border border-dashed border-omega-200 bg-omega-50 px-4 py-8 text-center text-sm text-omega-500">
                Nenhum dado operacional disponivel no momento.
              </div>
            ) : (
              veiculos.slice(0, 30).map(v => (
                <div key={v.tag} className="grid grid-cols-[80px_1fr_90px] items-center gap-2 py-1.5 px-2 rounded hover:bg-omega-50 transition-colors">
                  <div className="text-[11px] text-omega-600 truncate">{v.contrato}</div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-bold text-omega-900 shrink-0 w-10">{v.tag}</span>
                    <span className="text-[10px] font-mono text-omega-500 truncate">{v.placa}</span>
                  </div>
                  <div className={`text-[10px] font-bold py-1 px-2 rounded text-center text-white ${v.status === 'Mobilizado' ? 'bg-blue-600' : 'bg-red-700'}`}>
                    {v.status === 'Mobilizado' ? 'Mobilizado (Ativo)' : 'Desmobilizado (Desativado)'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="xl:col-span-2 space-y-5">
          <div className="card p-4">
            <div className="text-center text-xs font-bold text-omega-800 mb-3">
              Controle de Mobilizacao e Desmobilizacao
            </div>
            <div className="flex items-center justify-center gap-4 mb-3 text-[11px] font-semibold text-omega-600">
              <span className="flex items-center gap-1.5">
                Status <span className="w-2 h-2 rounded-full bg-red-700" /> Desmobilizado (Desativado) <span className="w-2 h-2 rounded-full bg-blue-600" /> Mobilizado (Ativo)
              </span>
            </div>
            <div className="space-y-3 px-4">
              {CONTRATOS.map(c => {
                const d = mobPorContrato[c] || { mob: 0, desmob: 0 };
                const total = d.mob + d.desmob;
                const wDesmob = total ? (d.desmob / maxMobContrato) * 100 : 0;
                const wMob = total ? (d.mob / maxMobContrato) * 100 : 0;
                return (
                  <div key={c} className="grid grid-cols-[120px_1fr_40px] items-center gap-3">
                    <div className="text-xs font-semibold text-omega-700">{c}</div>
                    <div className="flex h-9 rounded overflow-hidden shadow-inner bg-omega-100/60">
                      <div
                        className="bg-red-700 flex items-center justify-end px-2 text-white text-[11px] font-bold transition-all"
                        style={{ width: `${wDesmob}%`, minWidth: d.desmob > 0 ? '32px' : '0' }}
                      >
                        {d.desmob > 0 ? d.desmob : ''}
                      </div>
                      <div
                        className="bg-blue-600 flex items-center px-2 text-white text-[11px] font-bold transition-all"
                        style={{ width: `${wMob}%`, minWidth: d.mob > 0 ? '32px' : '0' }}
                      >
                        {d.mob > 0 ? d.mob : ''}
                      </div>
                    </div>
                    <div className="text-right font-black text-omega-800 text-sm tabular-nums">{total}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-4">
            <div className="text-center text-xs font-bold text-omega-800 mb-3">
              Controle de Modelos de Veiculos do Contrato
            </div>
            <div className="flex items-center justify-center gap-4 mb-3 text-[11px] font-semibold text-omega-600">
              <span className="flex items-center gap-1.5">
                Contrato <span className="w-2 h-2 rounded-full" style={{ background: '#92400E' }} /> Eletromecanica <span className="w-2 h-2 rounded-full" style={{ background: '#78350F' }} /> Serra Leste
              </span>
            </div>
            <div className="space-y-2 px-2">
              {MODELOS_ORDEM.slice(0, 10).map(m => {
                const data = modelosPorContrato[m] || {};
                const rows = [];
                CONTRATOS.slice(0, 2).forEach(c => {
                  const d = data[c] || { mob: 0, desmob: 0 };
                  if (d.mob === 0 && d.desmob === 0) return;
                  rows.push({ c, d, cor: c === 'Eletromecanica' ? '#92400E' : '#78350F' });
                });
                const total = rows.reduce((acc, r) => acc + r.d.mob + r.d.desmob, 0);
                if (total === 0) return null;
                const maxSeg = maxModelo;
                return (
                  <div key={m} className="grid grid-cols-[110px_1fr_36px] items-center gap-3 py-0.5">
                    <div className="text-[11px] font-semibold text-omega-700 truncate">{m}</div>
                    <div className="flex h-5 rounded overflow-hidden bg-omega-100/60 shadow-inner">
                      {rows.map((r, i) => {
                        const wDesmob = (r.d.desmob / maxSeg) * 100;
                        const wMob = (r.d.mob / maxSeg) * 100;
                        return (
                          <div key={i} className="flex flex-1 min-w-0">
                            <div
                              className="opacity-60"
                              style={{ width: `${wDesmob}%`, background: r.cor, minWidth: r.d.desmob > 0 ? '2px' : '0' }}
                              title={`${r.c} DESMOB: ${r.d.desmob}`}
                            />
                            <div
                              className="flex items-center justify-end px-1 text-white text-[9px] font-bold"
                              style={{ width: `${wMob}%`, background: r.cor, minWidth: r.d.mob > 0 ? '18px' : '0' }}
                            >
                              {r.d.mob >= 1 ? r.d.mob : ''}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-right font-black text-omega-800 text-xs tabular-nums">{total}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-4">
          <div className="text-center text-xs font-bold text-omega-800 mb-4">
            Farol de Vencimentos
          </div>
          <div className="space-y-3 px-2">
            {['EMDIA', 'VENCIDO', 'PLANEJAMENTO', 'CRITICO', 'ATENCAO'].map(k => {
              const v = docsPorFarol[k];
              const w = (v / maxFarol) * 100;
              return (
                <div key={k} className="grid grid-cols-[130px_1fr_36px] items-center gap-3">
                  <div className="text-[11px] font-semibold text-omega-700 text-right">{FAROL_LABEL[k]}</div>
                  <div className="h-8 rounded overflow-hidden bg-omega-100/60 shadow-inner">
                    <div
                      className="h-full flex items-center px-3 text-white text-xs font-bold"
                      style={{ width: `${w}%`, minWidth: v > 0 ? '40px' : '0', background: FAROL_COR[k] }}
                    >
                      {v > 0 ? v : ''}
                    </div>
                  </div>
                  <div className="text-right font-black text-omega-800 text-sm tabular-nums">{v}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-center text-xs font-bold text-omega-800 mb-4">
            Farol de Vencimentos por Modelo de Veiculo
          </div>
          <div className="flex items-end justify-center gap-10 px-4 pt-2 h-48">
            {Object.entries(docsPorFarolPorModelo).map(([modelo, data]) => {
              const total = Object.values(data).reduce((a, b) => a + b, 0);
              const ordem = ['EMDIA', 'ATENCAO', 'CRITICO', 'PLANEJAMENTO', 'VENCIDO'];
              return (
                <div key={modelo} className="flex flex-col items-center flex-1 max-w-[120px]">
                  <div className="text-xs font-bold text-omega-800 mb-2 tabular-nums">{total}</div>
                  <div className="w-20 flex flex-col-reverse rounded-t overflow-hidden shadow-inner min-h-[140px] bg-omega-100/30">
                    {ordem.map(k => {
                      const v = data[k];
                      if (v === 0) return null;
                      const h = (v / 8) * 100;
                      return (
                        <div
                          key={k}
                          className="w-full flex items-start justify-center text-white text-[10px] font-bold pt-0.5"
                          style={{ minHeight: v > 0 ? `${Math.max(h, 14)}px` : '0', background: FAROL_COR[k] }}
                        >
                          {v}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[11px] font-semibold text-omega-700 mt-2 text-center">{modelo}</div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-3 mt-4 flex-wrap text-[10px] font-semibold text-omega-600">
            {Object.entries(FAROL_LABEL).map(([k, lbl]) => (
              <span key={k} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FAROL_COR[k] }} />
                {lbl.split(' ')[0]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="text-center text-xs font-bold text-omega-800 mb-1">
          Farol de Vencimentos por TAG
        </div>
        <div className="flex items-center justify-center gap-3 mb-4 flex-wrap text-[10px] font-semibold text-omega-600">
          <span>Farol Vencimento</span>
          {Object.entries(FAROL_LABEL).map(([k, lbl]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FAROL_COR[k] }} />
              {lbl.split('(')[0].trim()} (...)
            </span>
          ))}
        </div>
        <div className="flex items-end justify-between gap-2 px-4 h-48 overflow-x-auto">
          {tagsRelevantes.map(tag => {
            const data = docsPorFarolPorTag[tag];
            const total = data ? Object.values(data).reduce((a, b) => a + b, 0) : 0;
            const ordem = ['EMDIA', 'ATENCAO', 'CRITICO', 'PLANEJAMENTO', 'VENCIDO'];
            return (
              <div key={tag} className="flex flex-col items-center min-w-[70px] flex-1 max-w-[90px]">
                <div className="text-[11px] font-bold text-omega-800 mb-1.5 tabular-nums">{total}</div>
                <div className="w-full flex flex-col-reverse rounded-t overflow-hidden shadow-inner min-h-[160px] bg-omega-100/30">
                  {ordem.map(k => {
                    const v = data?.[k] || 0;
                    if (v === 0) return null;
                    const h = (v / farolMaxTag) * 140 + 6;
                    return (
                      <div
                        key={k}
                        className="w-full flex items-center justify-center text-white text-[10px] font-bold"
                        style={{ height: `${h}px`, background: FAROL_COR[k] }}
                      >
                        {v}
                      </div>
                    );
                  })}
                </div>
                <div className="text-[11px] font-bold text-omega-900 mt-2">{tag}</div>
              </div>
            );
          })}
        </div>
      </div>

      {semDados && (
        <div className="card px-5 py-4 text-sm text-omega-500">
          O dashboard executivo foi mantido, mas esta aguardando o carregamento dos dados reais da operacao.
        </div>
      )}

      {powerBiUrl && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-omega-100 bg-omega-50">
            <div className="flex items-center gap-2">
              <ExternalLink size={16} className="text-omega-accent" />
              <div className="text-sm font-bold text-omega-900">Relatorio Power BI Oficial</div>
            </div>
            <a
              href={powerBiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-omega-accent hover:underline inline-flex items-center gap-1"
            >
              Abrir em nova aba <ExternalLink size={12} />
            </a>
          </div>
          <iframe
            title="Power BI Omega Track"
            src={powerBiUrl}
            className="w-full"
            style={{ height: '640px', border: 0 }}
            allowFullScreen
          />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { k: 'EMDIA', i: CheckCircle2, sub: '> 30 dias' },
          { k: 'ATENCAO', i: FileWarning, sub: '6-15 dias' },
          { k: 'CRITICO', i: AlertTriangle, sub: '1-5 dias' },
          { k: 'PLANEJAMENTO', i: Clock, sub: '16-30 dias' },
          { k: 'VENCIDO', i: AlertTriangle, sub: 'Expirado' },
        ].map(item => (
          <div key={item.k} className="card p-4" style={{ borderTop: `3px solid ${FAROL_COR[item.k]}` }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${FAROL_COR[item.k]}15`, color: FAROL_COR[item.k] }}>
                <item.i size={15} />
              </div>
              <span className="text-[10px] font-semibold text-omega-600 uppercase tracking-wide leading-tight">{item.sub}</span>
            </div>
            <div className="text-2xl font-black tabular-nums" style={{ color: FAROL_COR[item.k] }}>
              {docsPorFarol[item.k]}
            </div>
            <div className="text-[11px] font-semibold text-omega-500 mt-0.5">{FAROL_LABEL[item.k].split('(')[0].trim()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
