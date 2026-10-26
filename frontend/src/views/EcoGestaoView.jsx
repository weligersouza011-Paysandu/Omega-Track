// ============================================================================
// frontend/src/views/EcoGestaoView.jsx — Hub Central de EcoGestão (Omega-Track).
//
// Sistema de abas superiores (tabs) para navegar entre os 4 pilares:
//   1. Gestão de Resíduos (Ativo)
//   2. Consumo de Água Potável (Ativo)
//   3. Atos Autorizativos (Ativo)
//   4. Tratamento de Produtos Químicos (Em breve)
// ============================================================================
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Recycle,
  Droplets,
  FileCheck2,
  FlaskConical,
  Sprout,
  ShieldCheck,
  Gauge,
  Sparkles,
  Info,
} from 'lucide-react';
import ResiduosView from './ResiduosView.jsx';
import ConsumoAguaView from './ConsumoAguaView.jsx';
import AtosAutorizativosView from './AtosAutorizativosView.jsx';
import ProdutosQuimicosView from './ProdutosQuimicosView.jsx';

const ABAS = [
  {
    id: 'residuos',
    titulo: 'Gestão de Resíduos',
    icone: Recycle,
    ativo: true,
    descricao: 'Controle de MTR/MID, inventário volumétrico e destinações (CMD vs Externo).',
    subtitulo: 'Operacional',
  },
  {
    id: 'agua',
    titulo: 'Consumo de Água Potável',
    icone: Droplets,
    ativo: true,
    descricao: 'Monitoramento de captação, hidrômetros, média diária e picos de consumo (m³).',
    subtitulo: 'Hidrometria',
  },
  {
    id: 'atos',
    titulo: 'Atos Autorizativos',
    icone: FileCheck2,
    ativo: true,
    descricao: 'Gestão e controle de vencimentos de alvarás, licenças ambientais, certificados e condicionantes.',
    subtitulo: 'Licenças & Alvarás',
  },
  {
    id: 'quimicos',
    titulo: 'Tratamento de Produtos Químicos',
    icone: FlaskConical,
    ativo: true,
    descricao: 'Inventário químico, FDS/FISPQ, matriz de periculosidade, locais de armazenamento e validades.',
    subtitulo: 'FISPQ & Riscos',
  },
];

export default function EcoGestaoView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const abaUrl = searchParams.get('aba');

  const [abaAtiva, setAbaAtivaInterna] = useState(() => {
    return ABAS.some((a) => a.id === abaUrl) ? abaUrl : 'residuos';
  });

  useEffect(() => {
    if (abaUrl && ABAS.some((a) => a.id === abaUrl) && abaUrl !== abaAtiva) {
      setAbaAtivaInterna(abaUrl);
    }
  }, [abaUrl]);

  const setAbaAtiva = (novaAba) => {
    setAbaAtivaInterna(novaAba);
    setSearchParams({ aba: novaAba }, { replace: true });
  };

  const abaAtual = ABAS.find((a) => a.id === abaAtiva) || ABAS[0];

  return (
    <div className="space-y-6">
      {/* ==================================================================== */}
      {/* NAVEGAÇÃO SUPERIOR POR ABAS (TABS CORPORATIVAS)                      */}
      {/* ==================================================================== */}
      <div className="rounded-2xl border border-omega-800 bg-omega-900/90 p-2 shadow-card backdrop-blur-md">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
          {ABAS.map((aba) => {
            const isSelecionada = abaAtiva === aba.id;
            const Icone = aba.icone;
            const isAgua = aba.id === 'agua';
            const isAtos = aba.id === 'atos';
            const isQuimicos = aba.id === 'quimicos';

            return (
              <button
                key={aba.id}
                type="button"
                onClick={() => setAbaAtiva(aba.id)}
                className={`relative flex items-center justify-between gap-2.5 rounded-xl px-3.5 py-3 text-left transition-all duration-150 ${
                  isSelecionada
                    ? isAgua
                      ? 'bg-cyan-500/15 text-white border border-cyan-500/40 shadow-sm'
                      : isAtos
                      ? 'bg-amber-500/15 text-white border border-amber-500/40 shadow-sm'
                      : isQuimicos
                      ? 'bg-fuchsia-500/15 text-white border border-fuchsia-500/40 shadow-sm'
                      : 'bg-emerald-500/15 text-white border border-emerald-500/40 shadow-sm'
                    : 'text-omega-400 hover:text-omega-200 hover:bg-omega-800/40 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      isSelecionada
                        ? isAgua
                          ? 'bg-cyan-500 text-white shadow-sm'
                          : isAtos
                          ? 'bg-amber-500 text-white shadow-sm'
                          : isQuimicos
                          ? 'bg-fuchsia-500 text-white shadow-sm'
                          : 'bg-emerald-500 text-white shadow-sm'
                        : 'bg-omega-800/80 text-omega-400'
                    }`}
                  >
                    <Icone size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold leading-tight">
                      {aba.titulo}
                    </div>
                    <div className="truncate text-[10px] text-omega-500 mt-0.5 hidden sm:block">
                      {aba.subtitulo}
                    </div>
                  </div>
                </div>

                {aba.badge && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                      isSelecionada
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-omega-800 text-omega-400 border border-omega-700/50'
                    }`}
                  >
                    {aba.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* CONTEÚDO DA ABA ATIVA                                                */}
      {/* ==================================================================== */}
      {abaAtiva === 'residuos' && <ResiduosView />}

      {abaAtiva === 'agua' && <ConsumoAguaView />}

      {abaAtiva === 'atos' && <AtosAutorizativosView />}

      {abaAtiva === 'quimicos' && <ProdutosQuimicosView />}

      {abaAtiva !== 'residuos' && abaAtiva !== 'agua' && abaAtiva !== 'atos' && (
        <div className="rounded-2xl border border-omega-800 bg-omega-900 p-8 shadow-card text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto shadow-inner">
            <abaAtual.icone size={32} />
          </div>

          <div className="max-w-lg mx-auto space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
              <Sparkles size={13} /> Módulo em desenvolvimento
            </div>
            <h2 className="text-xl font-black text-white">{abaAtual.titulo}</h2>
            <p className="text-xs sm:text-sm text-omega-400 leading-relaxed">
              {abaAtual.descricao}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto pt-4 border-t border-omega-800 text-left">
            <div className="rounded-xl border border-omega-800 bg-omega-950/40 p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">
                Conformidade
              </div>
              <div className="text-xs font-bold text-white">Padrões Ambientais</div>
              <div className="text-[11px] text-omega-500 mt-1">
                Atendimento integral às normas ISO 14001 e auditorias do cliente.
              </div>
            </div>

            <div className="rounded-xl border border-omega-800 bg-omega-950/40 p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400 mb-1">
                Métricas ESG
              </div>
              <div className="text-xs font-bold text-white">Dashboards em Tempo Real</div>
              <div className="text-[11px] text-omega-500 mt-1">
                Indicadores mensais consolidados com exportação executiva.
              </div>
            </div>

            <div className="rounded-xl border border-omega-800 bg-omega-950/40 p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-1">
                Rastreabilidade
              </div>
              <div className="text-xs font-bold text-white">Controle Documental</div>
              <div className="text-[11px] text-omega-500 mt-1">
                Alertas prévios de vencimento e histórico de laudos técnicos.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
