import { useState } from 'react';
import { Camera, Calendar, MoreVertical, Edit3, Ban, FileText, Truck } from 'lucide-react';
import BadgeStatus from './BadgeStatus.jsx';

export default function VehicleCard({ veiculo, onEdit, onDesmob }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const diasMob = veiculo.data_desmob
    ? 0
    : Math.max(0, Math.ceil((new Date() - new Date(veiculo.data_mob)) / (1000 * 60 * 60 * 24)));

  return (
    <div className="card overflow-hidden group hover:shadow-card-hover transition-all duration-200">
      <div className="relative h-40 bg-omega-100 overflow-hidden">
        {veiculo.foto_veiculo ? (
          <img
            src={veiculo.foto_veiculo}
            alt={`Foto ${veiculo.tag}`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-omega-400">
            <Camera size={42} />
          </div>
        )}
        <div className="absolute inset-x-0 top-0 p-3 flex items-start justify-between">
          <div className="px-3 py-1.5 bg-white/95 backdrop-blur rounded-lg shadow-sm">
            <div className="text-[10px] text-omega-500 font-medium uppercase tracking-wider leading-none">TAG</div>
            <div className="text-lg font-extrabold text-omega-900 tracking-tight leading-tight">{veiculo.tag}</div>
          </div>
          <BadgeStatus status={veiculo.status} />
        </div>
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <span className="px-2.5 py-1 bg-omega-900/85 backdrop-blur text-white rounded-md text-xs font-bold tracking-wide">
            {veiculo.placa}
          </span>
        </div>
        <div className="absolute top-3 right-3 z-10">
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
              className="p-1.5 rounded-md bg-white/90 hover:bg-white text-omega-700 shadow-sm"
            >
              <MoreVertical size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-44 rounded-lg bg-white shadow-card-hover border border-omega-100 py-1 overflow-hidden">
                <button
                  onClick={() => onEdit?.(veiculo)}
                  className="w-full text-left px-3 py-2 text-sm text-omega-700 hover:bg-omega-50 flex items-center gap-2"
                >
                  <Edit3 size={14} /> Editar veiculo
                </button>
                <button
                  onClick={() => onDesmob?.(veiculo)}
                  disabled={veiculo.status === 'Desmobilizado'}
                  className="w-full text-left px-3 py-2 text-sm text-status-vermelho hover:bg-red-50 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Ban size={14} /> Registrar DESMOB
                </button>
                <button className="w-full text-left px-3 py-2 text-sm text-omega-700 hover:bg-omega-50 flex items-center gap-2">
                  <FileText size={14} /> Documentos
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <div className="flex items-start gap-2 mb-1">
            <Truck size={16} className="text-omega-500 mt-0.5 shrink-0" />
            <h3 className="font-bold text-omega-900 leading-snug line-clamp-1">{veiculo.modelo}</h3>
          </div>
          <p className="text-sm text-omega-500 pl-6 line-clamp-1">{veiculo.contrato}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-omega-100">
          <div>
            <div className="text-[10px] text-omega-500 uppercase font-semibold tracking-wide flex items-center gap-1">
              <Calendar size={10} /> Data MOB
            </div>
            <div className="text-sm font-semibold text-omega-800 tabular-nums">
              {new Date(veiculo.data_mob).toLocaleDateString('pt-BR')}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-omega-500 uppercase font-semibold tracking-wide">
              {veiculo.data_desmob ? 'Desmobilizado' : 'Dias na Operacao'}
            </div>
            <div className="text-sm font-semibold text-omega-800 tabular-nums">
              {veiculo.data_desmob
                ? new Date(veiculo.data_desmob).toLocaleDateString('pt-BR')
                : `${diasMob} dias`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
