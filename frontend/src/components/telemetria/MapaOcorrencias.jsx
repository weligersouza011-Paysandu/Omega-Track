// Mapa das ocorrências de telemetria (fadiga ou velocidade). Cor = farol (ou faixa, via corDe).
// Clique no ponto abre o histórico do condutor.
import { useEffect, useMemo } from 'react';
import { CircleMarker, LayerGroup, LayersControl, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
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

/** Camadas base dos mapas de telemetria: satélite (padrão, com vias e lugares) e ruas. */
export function CamadasMapa() {
  // Satélite por padrão (com nomes de vias e lugares por cima); "Mapa" mostra as ruas.
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Satélite">
        <LayerGroup>
          <TileLayer
            attribution="Imagens &copy; Esri, Maxar, Earthstar Geographics e comunidade GIS"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
            opacity={0.7}
          />
        </LayerGroup>
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Mapa">
        <TileLayer
          className="tiles-mapa"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      </LayersControl.BaseLayer>
    </LayersControl>
  );
}

const ORDEM_PADRAO = ['DESCARTADA', 'VEICULO_PARADO', 'TOLERANCIA', 'EM_ANALISE', 'ABAIXO_GATILHO', 'CONFIRMADA'];

export default function MapaOcorrencias({
  ocorrencias,
  onSelecionar,
  farois = FAROL_FADIGA,
  legenda = ['CONFIRMADA', 'EM_ANALISE', 'VEICULO_PARADO', 'DESCARTADA'].map((c) => ({ cor: FAROL_FADIGA[c].cor, rotulo: FAROL_FADIGA[c].curto })),
  corDe,
  detalhe = (o) => `${o.deteccoes.length} detecção(ões) · ${Math.round(o.velocidade_max)} km/h`,
}) {
  const comCoordenadas = useMemo(
    () => ocorrencias.filter((o) => Number.isFinite(o.latitude) && Number.isFinite(o.longitude)),
    [ocorrencias],
  );
  const pontos = useMemo(() => comCoordenadas.map((o) => [o.latitude, o.longitude]), [comCoordenadas]);
  // Confirmadas por cima das demais.
  const desenhadas = [...comCoordenadas].sort((a, b) => ORDEM_PADRAO.indexOf(a.classificacao) - ORDEM_PADRAO.indexOf(b.classificacao));

  return (
    <div className="relative">
      <MapContainer
        center={CENTRO_PADRAO}
        zoom={11}
        scrollWheelZoom
        className="mapa-telemetria z-0 h-[380px] w-full rounded-xl"
      >
        <CamadasMapa />
        <Enquadrar pontos={pontos} />
        {desenhadas.map((o) => {
          const farol = farois[o.classificacao] || Object.values(farois)[0];
          const cor = corDe ? corDe(o) : farol.cor;
          const confirmada = o.classificacao === 'CONFIRMADA';
          return (
            <CircleMarker
              key={o.chave}
              center={[o.latitude, o.longitude]}
              radius={confirmada ? 10 : 7}
              pathOptions={{
                // Contorno branco: contrasta com a imagem de satélite.
                color: '#FFFFFF',
                weight: 2,
                fillColor: cor,
                fillOpacity: o.classificacao === 'DESCARTADA' ? 0.35 : 0.9,
                dashArray: o.classificacao === 'DESCARTADA' ? '3 3' : null,
              }}
            >
              <Tooltip direction="top">{farol.curto} · {o.motorista || o.tag_placa}</Tooltip>
              <Popup>
                <div className="space-y-1 text-xs">
                  <div className="font-bold" style={{ color: cor }}>{farol.label}</div>
                  <div><strong>{o.motorista || 'Condutor não identificado'}</strong></div>
                  <div>{o.tag || 'Sem TAG'} · {o.tag_placa}</div>
                  <div>{formatarDataHora(o.inicio)} · {detalhe(o)}</div>
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
        {legenda.map((item) => (
          <span key={item.rotulo} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-slate-900/40" style={{ background: item.cor }} />
            {item.rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}
