// Aba "Trajeto & Rastreabilidade": veículo (TAG/placa), período em dias e janela de horário
// (-03:00) -> mapa com a linha do trajeto em ordem cronológica + tabela. Dados: GET /api/telemetria/trajeto.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { buscarTodasPaginas, buscarTodasPaginasComCache } from '../../utils/paginas.js';
import { CircleMarker, MapContainer, Polyline, Popup, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertCircle, ChevronLeft, ChevronRight, Clock, Crosshair, Loader2, MapPin, Route, Search, Truck, X,
} from 'lucide-react';
import { CamadasMapa } from './MapaOcorrencias.jsx';
import { apiTelemetria, formatarDataHora, obterHeaders } from '../../utils/telemetriaApi.js';
import {
  ATALHOS_PERIODO, STATUS_MOBILIZACAO, agruparTrajetos, atalhoAtivo, dataBrasilia, filtrarVeiculos, normalizarPlaca,
  paramsTrajeto, periodoDoAtalho, statusDoCadastro, temCoordenadas, textoVelocidade, validarFiltroTrajeto,
} from '../../utils/trajetoTelemetria.js';

const CENTRO_PADRAO = [-6.07, -50.13];
const POR_PAGINA = 100;
const CORES_LINHA = ['#2563EB', '#DB2777', '#059669', '#D97706', '#7C3AED', '#0891B2', '#DC2626', '#4B5563'];
const COR_INICIO = '#16A34A';
const COR_FIM = '#DC2626';

function BadgeMobilizacao({ status, className = '' }) {
  const info = STATUS_MOBILIZACAO[status];
  if (!info) return null;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${info.classe} ${className}`}>
      {info.label}
    </span>
  );
}

// ----------------------------------------------------------------------------
// Seletor pesquisável de veículo (TAG + placa); aceita placa fora do cadastro.
// ----------------------------------------------------------------------------
function SeletorVeiculo({ veiculos, valor, onChange, carregando }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const caixa = useRef(null);

  useEffect(() => {
    const fechar = (e) => { if (caixa.current && !caixa.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, []);

  const opcoes = useMemo(() => filtrarVeiculos(veiculos, texto), [veiculos, texto]);
  const placaLivre = normalizarPlaca(texto);
  const mostraLivre = placaLivre.length >= 5 && !opcoes.some((v) => normalizarPlaca(v.placa) === placaLivre);

  function escolher(v) {
    onChange(v);
    setTexto('');
    setAberto(false);
  }

  return (
    <div className="relative min-w-0" ref={caixa}>
      <label className="mb-1 block text-xs font-bold text-omega-600">Veículo</label>
      {valor ? (
        <div className="flex h-10 items-center gap-2 rounded-lg border border-omega-200 bg-white px-3 text-sm">
          <Truck size={15} className="shrink-0 text-omega-500" />
          <span className="truncate font-semibold text-omega-900">{valor.tag ? `${valor.tag} · ${valor.placa}` : valor.placa}</span>
          <BadgeMobilizacao status={valor.tag ? statusDoCadastro(valor) : 'NAO_CADASTRADO'} />
          <button type="button" onClick={() => onChange(null)} className="ml-auto text-omega-400 hover:text-omega-700" title="Limpar veículo">
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
          <input
            type="text"
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setAberto(true); }}
            onFocus={() => setAberto(true)}
            placeholder={carregando ? 'Carregando frota…' : 'Todos os veículos — busque TAG ou placa'}
            className="input h-10 pl-9"
          />
        </div>
      )}
      {aberto && !valor && (
        <div className="absolute z-[1000] mt-1 max-h-72 w-full min-w-[260px] overflow-y-auto rounded-lg border border-omega-200 bg-white py-1 shadow-lg">
          {mostraLivre && (
            <button
              type="button"
              onClick={() => escolher({ tag: null, placa: placaLivre })}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-omega-50"
            >
              <Search size={14} className="text-omega-400" /> Buscar a placa <strong>{placaLivre}</strong>
              <BadgeMobilizacao status="NAO_CADASTRADO" className="ml-auto" />
            </button>
          )}
          {opcoes.map((v) => (
            <button
              key={v.tag}
              type="button"
              onClick={() => escolher(v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-omega-50"
            >
              <span className="font-semibold text-omega-900">{v.tag}</span>
              <span className="text-omega-500">{v.placa}</span>
              <BadgeMobilizacao status={statusDoCadastro(v)} className="ml-auto" />
            </button>
          ))}
          {!opcoes.length && !mostraLivre && (
            <div className="px-3 py-2 text-xs text-omega-500">Nenhum veículo encontrado.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Mapa do trajeto
// ----------------------------------------------------------------------------
function Enquadrar({ coordenadas }) {
  const mapa = useMap();
  useEffect(() => {
    if (!coordenadas.length) return;
    if (coordenadas.length === 1) mapa.setView(coordenadas[0], 15);
    else mapa.fitBounds(coordenadas, { padding: [30, 30], maxZoom: 16 });
  }, [mapa, coordenadas]);
  return null;
}

function FocarPonto({ ponto, marcadores }) {
  const mapa = useMap();
  useEffect(() => {
    if (!ponto) return;
    mapa.setView([ponto.latitude, ponto.longitude], Math.max(mapa.getZoom(), 16), { animate: true });
    marcadores.current.get(ponto.id)?.openPopup();
  }, [mapa, ponto, marcadores]);
  return null;
}

function PopupPonto({ p, rotulo }) {
  return (
    <Popup>
      <div className="space-y-1 text-xs">
        {rotulo && <div className="font-bold uppercase tracking-wide text-omega-500">{rotulo}</div>}
        <div className="font-bold text-omega-900">{formatarDataHora(p.data_hora)}</div>
        <div>{p.tag ? `${p.tag} · ` : ''}{p.tag_placa}</div>
        <div><strong>{p.evento}</strong>{p.severidade && p.severidade !== 'NORMAL' ? ` · ${p.severidade}` : ''}</div>
        <div>Velocidade: {textoVelocidade(p)}</div>
        {p.motorista && <div>Condutor: {p.motorista}</div>}
        {p.localizacao && <div className="text-slate-500">{p.localizacao}</div>}
        {p.cerca && <div className="text-slate-500">{p.cerca}</div>}
      </div>
    </Popup>
  );
}

function MapaTrajeto({ grupos, selecionado, onSelecionar }) {
  const marcadores = useRef(new Map());
  const coordenadas = useMemo(() => grupos.flatMap((g) => g.pontos.map((p) => [p.latitude, p.longitude])), [grupos]);
  const varios = grupos.length > 1;

  const registrar = (id) => (camada) => {
    if (camada) marcadores.current.set(id, camada);
    else marcadores.current.delete(id);
  };

  return (
    <div className="relative">
      <MapContainer center={CENTRO_PADRAO} zoom={11} scrollWheelZoom preferCanvas className="mapa-telemetria z-0 h-[460px] w-full rounded-xl">
        <CamadasMapa />
        <Enquadrar coordenadas={coordenadas} />
        <FocarPonto ponto={selecionado} marcadores={marcadores} />
        {grupos.map((g, i) => {
          const cor = CORES_LINHA[i % CORES_LINHA.length];
          const nome = g.tag ? `${g.tag} · ${g.placa}` : g.placa;
          const ultimo = g.pontos.length - 1;
          return (
            <Fragment key={g.chave}>
              <Polyline positions={g.pontos.map((p) => [p.latitude, p.longitude])} pathOptions={{ color: cor, weight: 4, opacity: 0.85 }} />
              {g.pontos.map((p, idx) => {
                const extremo = idx === 0 ? 'Início' : idx === ultimo ? 'Fim' : null;
                const preenchimento = idx === 0 ? COR_INICIO : idx === ultimo ? COR_FIM : cor;
                return (
                  <CircleMarker
                    key={p.id}
                    ref={registrar(p.id)}
                    center={[p.latitude, p.longitude]}
                    radius={extremo ? 9 : 5}
                    pathOptions={{ color: '#FFFFFF', weight: extremo ? 3 : 1.5, fillColor: preenchimento, fillOpacity: 0.95 }}
                    eventHandlers={{ click: () => onSelecionar(p.id) }}
                  >
                    {extremo && (
                      <Tooltip permanent direction="top" offset={[0, -8]} className="font-bold">
                        {varios ? `${extremo} · ${nome}` : extremo}
                      </Tooltip>
                    )}
                    <PopupPonto p={p} rotulo={extremo ? `${extremo} do trajeto${varios ? ` · ${nome}` : ''}` : null} />
                  </CircleMarker>
                );
              })}
            </Fragment>
          );
        })}
        {selecionado && (
          <CircleMarker
            center={[selecionado.latitude, selecionado.longitude]}
            radius={15}
            interactive={false}
            pathOptions={{ color: '#FACC15', weight: 4, fill: false }}
          />
        )}
      </MapContainer>
      {!coordenadas.length && (
        <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center">
          <span className="flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-2 text-xs font-semibold text-omega-600 shadow">
            <MapPin size={14} /> Nenhum registro com coordenadas no filtro atual
          </span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 z-[400] flex flex-wrap gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-omega-700 shadow">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COR_INICIO }} /> Início</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COR_FIM }} /> Fim</span>
        {grupos.length === 1 && (
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: CORES_LINHA[0] }} /> Trajeto</span>
        )}
        {varios && grupos.slice(0, 8).map((g, i) => (
          <span key={g.chave} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4" style={{ background: CORES_LINHA[i % CORES_LINHA.length] }} /> {g.tag || g.placa}
          </span>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Aba
// ----------------------------------------------------------------------------
export default function TrajetoTab({ versao = 0 }) {
  const [veiculos, setVeiculos] = useState([]);
  const [carregandoFrota, setCarregandoFrota] = useState(true);
  const [veiculo, setVeiculo] = useState(null);
  const [filtro, setFiltro] = useState(() => ({ dataInicio: dataBrasilia(0), dataFim: dataBrasilia(0), horaInicio: '00:00', horaFim: '23:59' }));
  const [resultado, setResultado] = useState(null);
  const [consultado, setConsultado] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [pagina, setPagina] = useState(1);
  const linhas = useRef(new Map());

  useEffect(() => {
    let ativo = true;
    buscarTodasPaginasComCache('/api/mob-desmob', { headers: obterHeaders() })
      .then((lista) => { if (ativo) setVeiculos(lista); })
      .catch(() => {})
      .finally(() => { if (ativo) setCarregandoFrota(false); });
    return () => { ativo = false; };
  }, []);

  async function consultar(alvo = { ...filtro, veiculo: veiculo ? (veiculo.tag || veiculo.placa) : '' }) {
    const invalido = validarFiltroTrajeto(alvo);
    if (invalido) { setErro(invalido); return; }
    setCarregando(true);
    setErro(null);
    try {
      const dados = await apiTelemetria(`/trajeto?${paramsTrajeto(alvo)}`, { erro: 'Erro ao buscar o trajeto' });
      setResultado(dados);
      setConsultado(alvo);
      setSelecionadoId(null);
      setPagina(1);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  // Exclusão de placa (alerta) ou importação: refaz a última consulta.
  useEffect(() => {
    if (versao && consultado) consultar(consultado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao]);

  const pontos = resultado?.pontos || [];
  const grupos = useMemo(() => agruparTrajetos(pontos), [pontos]);
  const selecionado = useMemo(() => pontos.find((p) => p.id === selecionadoId && temCoordenadas(p)) || null, [pontos, selecionadoId]);
  const totalPaginas = Math.max(1, Math.ceil(pontos.length / POR_PAGINA));
  const visiveis = pontos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const semCoordenadas = pontos.filter((p) => !temCoordenadas(p)).length;

  // Clique no mapa: leva a tabela até a linha do ponto.
  function selecionarDoMapa(id) {
    setSelecionadoId(id);
    const indice = pontos.findIndex((p) => p.id === id);
    if (indice >= 0) setPagina(Math.floor(indice / POR_PAGINA) + 1);
    setTimeout(() => linhas.current.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }

  const atalho = atalhoAtivo(filtro);
  const muda = (campo) => (e) => setFiltro((f) => ({ ...f, [campo]: e.target.value }));
  const infoVeiculo = resultado?.veiculo;

  return (
    <div className="space-y-4">
      <form
        className="card space-y-3 p-4"
        onSubmit={(e) => { e.preventDefault(); consultar(); }}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.4fr)_auto_auto_auto]">
          <SeletorVeiculo veiculos={veiculos} valor={veiculo} onChange={setVeiculo} carregando={carregandoFrota} />
          <div>
            <label className="mb-1 block text-xs font-bold text-omega-600">Período</label>
            <div className="flex items-center gap-2">
              <input type="date" value={filtro.dataInicio} max={filtro.dataFim || undefined} onChange={muda('dataInicio')} className="input h-10 w-auto" aria-label="Data inicial" required />
              <span className="text-xs text-omega-400">até</span>
              <input type="date" value={filtro.dataFim} min={filtro.dataInicio || undefined} onChange={muda('dataFim')} className="input h-10 w-auto" aria-label="Data final" required />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-omega-600">Horário (Brasília)</label>
            <div className="flex items-center gap-2">
              <input type="time" value={filtro.horaInicio} onChange={muda('horaInicio')} className="input h-10 w-auto" aria-label="Hora início" required />
              <span className="text-xs text-omega-400">às</span>
              <input type="time" value={filtro.horaFim} onChange={muda('horaFim')} className="input h-10 w-auto" aria-label="Hora fim" required />
            </div>
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary h-10 w-full justify-center" disabled={carregando}>
              {carregando ? <Loader2 size={16} className="animate-spin" /> : <Route size={16} />} Consultar trajeto
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ATALHOS_PERIODO.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setFiltro((f) => ({ ...f, ...periodoDoAtalho(a.id) }))}
              className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset transition ${
                atalho === a.id ? 'bg-omega-900 text-white ring-omega-900' : 'bg-white text-omega-600 ring-omega-200 hover:bg-omega-50'
              }`}
            >
              {a.label}
            </button>
          ))}
          {(filtro.horaInicio !== '00:00' || filtro.horaFim !== '23:59') && (
            <button
              type="button"
              onClick={() => setFiltro((f) => ({ ...f, horaInicio: '00:00', horaFim: '23:59' }))}
              className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold text-omega-500 ring-1 ring-inset ring-omega-200 hover:bg-omega-50"
            >
              <Clock size={12} /> Dia inteiro
            </button>
          )}
          <span className="text-xs text-omega-400">A janela de horário vale para cada dia do período.</span>
        </div>
      </form>

      {erro && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-status-vermelho">
          <AlertCircle size={16} className="shrink-0" /> <span>{erro}</span>
        </div>
      )}

      {!resultado && !carregando && (
        <div className="card flex flex-col items-center gap-2 p-10 text-center text-sm text-omega-500">
          <Route size={28} className="text-omega-300" />
          Escolha o veículo, o período e o horário e clique em <strong>Consultar trajeto</strong>.
        </div>
      )}

      {resultado && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-omega-600">
            {infoVeiculo ? (
              <>
                <Truck size={16} className="text-omega-500" />
                <strong className="text-omega-900">{infoVeiculo.tag ? `${infoVeiculo.tag} · ${infoVeiculo.placa}` : infoVeiculo.placa}</strong>
                <BadgeMobilizacao status={infoVeiculo.status_mobilizacao} />
              </>
            ) : (
              <strong className="text-omega-900">Todos os veículos</strong>
            )}
            <span>· {pontos.length} {pontos.length === 1 ? 'registro' : 'registros'}</span>
            {grupos.length > 1 && <span>· {grupos.length} veículos no mapa</span>}
            {semCoordenadas > 0 && <span className="text-omega-400">· {semCoordenadas} sem coordenadas (só na tabela)</span>}
            {resultado.truncado && (
              <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-status-amarelo">
                Limite atingido: refine o período ou o horário para ver todos os registros.
              </span>
            )}
          </div>

          <MapaTrajeto grupos={grupos} selecionado={selecionado} onSelecionar={selecionarDoMapa} />

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-omega-50 text-left text-xs font-bold uppercase tracking-wide text-omega-500">
                  <tr>
                    <th className="px-3 py-2">Data / Hora</th>
                    <th className="px-3 py-2">TAG / Placa</th>
                    <th className="px-3 py-2">Evento / Status</th>
                    <th className="px-3 py-2">Velocidade / Limite</th>
                    <th className="px-3 py-2">Localização / Cerca</th>
                    <th className="px-3 py-2 text-right">Mapa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-omega-100">
                  {visiveis.map((p) => {
                    const ativo = p.id === selecionadoId;
                    const geo = temCoordenadas(p);
                    return (
                      <tr
                        key={p.id}
                        ref={(el) => { if (el) linhas.current.set(p.id, el); else linhas.current.delete(p.id); }}
                        onClick={() => geo && setSelecionadoId(p.id)}
                        className={`${geo ? 'cursor-pointer' : ''} ${ativo ? 'bg-yellow-50' : 'hover:bg-omega-50/60'}`}
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-semibold text-omega-900">{formatarDataHora(p.data_hora)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <div className="font-semibold text-omega-800">{p.tag || '—'}</div>
                          <div className="text-xs text-omega-500">{p.tag_placa}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-omega-800">{p.evento}</div>
                          {p.severidade && p.severidade !== 'NORMAL' && <div className="text-xs font-semibold text-status-vermelho">{p.severidade}</div>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{textoVelocidade(p)}</td>
                        <td className="max-w-xs px-3 py-2">
                          <div className="truncate text-omega-700" title={p.localizacao || ''}>{p.localizacao || '—'}</div>
                          {p.cerca && <div className="text-xs text-omega-500">{p.cerca}</div>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={!geo}
                            onClick={(e) => { e.stopPropagation(); setSelecionadoId(p.id); }}
                            title={geo ? 'Focar no mapa' : 'Sem coordenadas'}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-omega-600 ring-1 ring-omega-200 hover:bg-omega-50 disabled:opacity-40"
                          >
                            <Crosshair size={13} /> Focar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!visiveis.length && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-omega-500">Nenhum registro no período e horário selecionados.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {totalPaginas > 1 && (
              <div className="flex items-center justify-between border-t border-omega-100 px-3 py-2 text-xs text-omega-500">
                <span>Página {pagina} de {totalPaginas}</span>
                <div className="flex gap-1">
                  <button type="button" className="btn-secondary px-2 py-1" disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}><ChevronLeft size={14} /></button>
                  <button type="button" className="btn-secondary px-2 py-1" disabled={pagina >= totalPaginas} onClick={() => setPagina((n) => n + 1)}><ChevronRight size={14} /></button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
