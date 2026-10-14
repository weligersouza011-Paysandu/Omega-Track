import { X, Edit3, Calendar, FileText, ClipboardList, ChevronRight, Expand, Plus, Power } from 'lucide-react';
import BadgeStatus from './BadgeStatus.jsx';
import { documentos, partesDiarias } from '../data/mockData.js';

function calcularFarol(validade) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const v = new Date(validade); v.setHours(0, 0, 0, 0);
  const dias = Math.ceil((v - hoje) / 86400000);
  if (dias < 0) return 'VERMELHO';
  if (dias < 15) return 'AMARELO';
  return 'VERDE';
}

const FAROL_DOT = {
  VERDE: 'bg-status-verde',
  AMARELO: 'bg-status-amarelo',
  VERMELHO: 'bg-status-vermelho',
};

export default function VehicleDetailPanel({ veiculo, onClose, onEdit, onDesmob }) {
  if (!veiculo) return null;

  const docsVeiculo = documentos.filter(d => d.tag === veiculo.tag);
  const pdVeiculo = partesDiarias.filter(p => p.tag === veiculo.tag);

  const diasMob = veiculo.data_desmob
    ? 0
    : Math.max(0, Math.ceil((new Date() - new Date(veiculo.data_mob)) / (1000 * 60 * 60 * 24)));

  return (
    <div className="h-full flex flex-col bg-white border-l border-omega-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-omega-100 shrink-0">
        <div className="text-xs font-semibold text-omega-500 uppercase tracking-wider">
          Ficha do Veiculo
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-900 transition-colors"
            title="Editar veiculo"
          >
            <Edit3 size={16} />
          </button>
          {veiculo.status !== 'Desmobilizado' && (
            <button
              onClick={() => onDesmob?.(veiculo)}
              className="p-1.5 rounded-md hover:bg-red-50 text-omega-400 hover:text-red-700 transition-colors"
              title="Desmobilizar veículo (apaga documentos e anexos)"
            >
              <Power size={16} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-900 transition-colors"
            title="Fechar painel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="relative h-56 bg-omega-100 overflow-hidden shrink-0">
          <img
            src={veiculo.foto_veiculo}
            alt={`Foto ${veiculo.tag}`}
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
            <div>
              <div className="px-3 py-1.5 bg-white rounded-lg shadow-sm inline-block mb-2">
                <div className="text-[10px] font-semibold text-omega-500 uppercase tracking-wider leading-none">TAG</div>
                <div className="text-3xl font-black text-omega-900 tracking-tight leading-tight">{veiculo.tag}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 bg-omega-900/85 backdrop-blur text-white rounded-md text-xs font-bold tracking-wide">
                  {veiculo.placa}
                </span>
                <BadgeStatus status={veiculo.status} />
              </div>
            </div>
            <button
              onClick={onEdit}
              className="btn-primary !py-2 !px-3 text-xs shadow-lg"
            >
              <Edit3 size={14} /> Editar
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-omega-100 bg-omega-50 p-3">
              <div className="text-[10px] text-omega-500 uppercase font-semibold tracking-wide flex items-center gap-1 mb-1">
                <Calendar size={10} /> Data MOB
              </div>
              <div className="text-sm font-bold text-omega-800 tabular-nums">
                {new Date(veiculo.data_mob).toLocaleDateString('pt-BR')}
              </div>
              {!veiculo.data_desmob && (
                <div className="text-[11px] text-omega-500 mt-0.5">{diasMob} dias na operacao</div>
              )}
            </div>
            <div className="rounded-xl border border-omega-100 bg-omega-50 p-3">
              <div className="text-[10px] text-omega-500 uppercase font-semibold tracking-wide mb-1">
                Modelo
              </div>
              <div className="text-sm font-bold text-omega-800 leading-tight line-clamp-2">
                {veiculo.categoria || veiculo.modelo}
              </div>
            </div>
            <div className="rounded-xl border border-omega-100 bg-omega-50 p-3">
              <div className="text-[10px] text-omega-500 uppercase font-semibold tracking-wide mb-1">
                Contrato
              </div>
              <div className="text-sm font-bold text-omega-800 leading-tight">
                {veiculo.contrato}
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-omega-100 bg-omega-50/50">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-omega-accent/15 flex items-center justify-center text-omega-accent">
                  <FileText size={14} />
                </div>
                <div>
                  <div className="text-sm font-bold text-omega-900">Documentacao Veiculos</div>
                  <div className="text-[11px] text-omega-500">{docsVeiculo.length} documentos</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button className="text-[11px] font-semibold text-omega-600 hover:text-omega-900 px-2 py-1 rounded hover:bg-omega-100 inline-flex items-center gap-1 transition-colors">
                  <Expand size={12} /> Expandir
                </button>
                <button className="text-[11px] font-semibold text-omega-accent hover:underline px-2 py-1 rounded inline-flex items-center gap-1 transition-colors">
                  <Plus size={12} /> Adicionar
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-sm">
                <thead className="bg-white sticky top-0 z-10">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-semibold border-b border-omega-100">
                    <th className="px-4 py-2.5">TAG</th>
                    <th className="px-4 py-2.5">Validade</th>
                    <th className="px-4 py-2.5">Documento</th>
                    <th className="px-4 py-2.5 w-16">Farol</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-omega-100">
                  {docsVeiculo.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-xs text-omega-500">
                        Nenhum documento encontrado.
                      </td>
                    </tr>
                  ) : (
                    docsVeiculo.map(d => {
                      const farol = calcularFarol(d.validade);
                      return (
                        <tr key={d.id} className="hover:bg-omega-50">
                          <td className="px-4 py-2.5 font-mono text-xs font-semibold text-omega-800">{d.tag}</td>
                          <td className="px-4 py-2.5 tabular-nums text-xs text-omega-700">
                            {new Date(d.validade).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-omega-700 max-w-[200px] truncate" title={d.documento}>
                            {d.documento}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2.5 h-2.5 rounded-full ${FAROL_DOT[farol]}`} />
                              <span className="text-[11px] font-semibold text-omega-600">
                                {farol === 'VERDE' ? 'OK' : farol === 'AMARELO' ? 'Aten' : 'Venc.'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {docsVeiculo.length > 0 && (
              <div className="px-4 py-2 border-t border-omega-100 bg-omega-50/30">
                <input type="range" className="w-full accent-omega-accent" min={0} max={docsVeiculo.length} defaultValue={docsVeiculo.length} />
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-omega-100 bg-omega-50/50">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-status-amarelo/15 flex items-center justify-center text-status-amarelo">
                  <ClipboardList size={14} />
                </div>
                <div>
                  <div className="text-sm font-bold text-omega-900">Related Parte Diarias</div>
                  <div className="text-[11px] text-omega-500">{pdVeiculo.length} registros</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button className="text-[11px] font-semibold text-omega-600 hover:text-omega-900 px-2 py-1 rounded hover:bg-omega-100 inline-flex items-center gap-1 transition-colors">
                  <Expand size={12} /> Expandir
                </button>
                <button className="text-[11px] font-semibold text-omega-accent hover:underline px-2 py-1 rounded inline-flex items-center gap-1 transition-colors">
                  <Plus size={12} /> Adicionar
                </button>
              </div>
            </div>
            {pdVeiculo.length > 0 && (
              <div className="px-4 py-3 border-b border-omega-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm bg-status-vermelho" />
                    <span className="text-[11px] font-semibold text-omega-600">Count</span>
                  </div>
                  <span className="text-[10px] text-omega-400 font-semibold">{pdVeiculo.length}</span>
                </div>
                <div className="flex items-end gap-1 h-20">
                  {pdVeiculo.slice(0, 8).reverse().map((p, idx) => {
                    const height = idx === pdVeiculo.slice(0, 8).length - 1 ? '90%' : `${8 + Math.random() * 14}%`;
                    return (
                      <div
                        key={p.id}
                        className="flex-1 bg-status-vermelho/90 rounded-t transition-all hover:bg-status-vermelho"
                        style={{ height }}
                        title={`${new Date(p.data).toLocaleDateString('pt-BR')} - ${p.obra}`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1 text-[9px] text-omega-400">
                  <span>Parte Diaria Fechamento</span>
                  <span>Penetrate</span>
                </div>
              </div>
            )}
            <div className="overflow-x-auto max-h-48">
              <table className="w-full text-sm">
                <thead className="bg-white sticky top-0 z-10">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-semibold border-b border-omega-100">
                    <th className="px-4 py-2.5">Data</th>
                    <th className="px-4 py-2.5">Obra</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Assina.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-omega-100">
                  {pdVeiculo.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-xs text-omega-500">
                        Nenhuma parte diaria registrada.
                      </td>
                    </tr>
                  ) : (
                    pdVeiculo.slice(0, 6).map(p => (
                      <tr key={p.id} className="hover:bg-omega-50">
                        <td className="px-4 py-2 tabular-nums text-xs text-omega-700">
                          {new Date(p.data).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-4 py-2 text-xs text-omega-700 max-w-[140px] truncate" title={p.obra}>
                          {p.obra}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          <BadgeStatus status={p.status} dot={false} />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <BadgeStatus status={p.status_assinatura} dot={false} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
