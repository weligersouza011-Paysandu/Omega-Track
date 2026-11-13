// Mapa das ocorrências de fadiga detectada (cor = farol). Clique abre o condutor.
import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';
import { FAROL_FADIGA, formatarDataHora } from '../../utils/telemetriaApi.js';

// Parauapebas / Carajás: centro padrão quando não há coordenadas.
const CENTRO_PADRAO = [-6.07, -50.13];

function Enquadrar({ pontos }) {
  const mapa = useMap();
  useEffect(() => {
    if (!pontos.length) return;
    if (pontos.length === 1) {
      mapa.setView(pontos[0], 13);
      return;
    }
    mapa.fitBounds(pontos, { padding: [30, 30], maxZoom: 14 });
  }, [mapa, pontos]);
  return null;
}

export default function MapaFadiga({ ocorrencias, onSelecionar }) {
  const comCoordenadas = useMemo(
    () => ocorrencias.filter((o) => Number.isFinite(o.latitude) && Number.isFinite(o.longitude)),
    [ocorrencias],
  );
  const pontos = useMemo(() => comCoordenadas.map((o) => [o.latitude, o.longitude]), [comCoordenadas]);
  // Confirmadas por cima das demais.
  const ordem = ['DESCARTADA', 'VEICULO_PARADO', 'EM_ANALISE', 'CONFIRMADA'];
  const desenhadas = [...comCoordenadas].sort((a, b) => ordem.indexOf(a.classificacao) - ordem.indexOf(b.classificacao));

  return (
    <div className="relative">
      <MapContainer
        center={CENTRO_PADRAO}
        zoom={11}
        scrollWheelZoom
        className="mapa-telemetria z-0 h-[380px] w-full rounded-xl"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Enquadrar pontos={pontos} />
        {desenhadas.map((o) => {
          const farol = FAROL_FADIGA[o.classificacao] || FAROL_FADIGA.EM_ANALISE;
          const confirmada = o.classificacao === 'CONFIRMADA';
          return (
            <CircleMarker
              key={o.chave}
              center={[o.latitude, o.longitude]}
              radius={confirmada ? 10 : 7}
              pathOptions={{
                color: '#0F172A',
                weight: 1.5,
                fillColor: farol.cor,
                fillOpacity: o.classificacao === 'DESCARTADA' ? 0.35 : 0.9,
                dashArray: o.classificacao === 'DESCARTADA' ? '3 3' : null,
              }}
            >
              <Tooltip direction="top">{farol.curto} · {o.motorista || o.tag_placa}</Tooltip>
              <Popup>
                <div className="space-y-1 text-xs">
                  <div className="font-bold" style={{ color: farol.cor }}>{farol.label}</div>
                  <div><strong>{o.motorista || 'Condutor não identificado'}</strong></div>
                  <div>{o.tag || 'Sem TAG'} · {o.tag_placa}</div>
                  <div>{formatarDataHora(o.inicio)} · {o.deteccoes.length} detecção(ões) · {Math.round(o.velocidade_max)} km/h</div>
                  {o.localizacao && <div className="text-slate-500">{o.localizacao}</div>}
                  {o.motorista && (
                    <button
                      type="button"
                      onClick={() => onSelecionar(o)}
                      className="mt-1 rounded bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white"
                    >
                      Ver histórico do condutor
                    </button>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      {!comCoordenadas.length && (
        <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center">
          <span className="flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-2 text-xs font-semibold text-omega-600 shadow">
            <MapPin size={14} /> Nenhuma ocorrência com coordenadas no filtro atual
          </span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 z-[400] flex flex-wrap gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-omega-700 shadow">
        {['CONFIRMADA', 'EM_ANALISE', 'VEICULO_PARADO', 'DESCARTADA'].map((c) => (
          <span key={c} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-slate-900/40" style={{ background: FAROL_FADIGA[c].cor }} />
            {FAROL_FADIGA[c].curto}
          </span>
        ))}
      </div>
    </div>
  );
}
