import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, AlertTriangle, Search, Download, FileText, ExternalLink, Plus, Paperclip } from 'lucide-react';
import StatCard from '../components/StatCard.jsx';
import BadgeStatus from '../components/BadgeStatus.jsx';
import Modal from '../components/Modal.jsx';
import { documentos as initialDocs, veiculos } from '../data/mockData.js';

function farol(validade) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const v = new Date(validade); v.setHours(0, 0, 0, 0);
  const dias = Math.ceil((v - hoje) / 86400000);
  let status = 'VERDE';
  if (dias < 0) status = 'VERMELHO';
  else if (dias < 15) status = 'AMARELO';
  return { status, dias };
}

export default function FarolDocumentosView() {
  const [docs] = useState(initialDocs);
  const [busca, setBusca] = useState('');
  const [filtroFarol, setFiltroFarol] = useState('todos');
  const [modalAnexo, setModalAnexo] = useState(null);
  const [modalNovo, setModalNovo] = useState(false);

  const enriquecidos = useMemo(() => docs.map(d => {
    const f = farol(d.validade);
    const veic = veiculos.find(v => v.tag === d.tag);
    return { ...d, ...f, modelo: veic?.modelo || '' };
  }), [docs]);

  const contagem = useMemo(() => ({
    VERMELHO: enriquecidos.filter(d => d.status === 'VERMELHO').length,
    AMARELO: enriquecidos.filter(d => d.status === 'AMARELO').length,
    VERDE: enriquecidos.filter(d => d.status === 'VERDE').length,
  }), [enriquecidos]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return enriquecidos.filter(d => {
      if (filtroFarol !== 'todos' && d.status !== filtroFarol) return false;
      if (!q) return true;
      return (
        d.tag.toUpperCase().includes(q) ||
        d.placa.toUpperCase().includes(q) ||
        d.documento.toUpperCase().includes(q)
      );
    }).sort((a, b) => new Date(a.validade) - new Date(b.validade));
  }, [enriquecidos, busca, filtroFarol]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Compliance & Validacao</div>
          <h1 className="mt-1 text-2xl font-extrabold text-omega-900 tracking-tight sm:text-3xl">Farol de Documentos</h1>
          <p className="mt-1 text-sm text-omega-500">
            Monitoramento automatico de vigencia: CRLV, laudos, ART e demais documentos da frota.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary"><Download size={16} /> Exportar</button>
          <button className="btn-primary" onClick={() => setModalNovo(true)}><Plus size={16} /> Novo Documento</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Vencidos / Criticos" value={contagem.VERMELHO} icon={AlertTriangle} iconBg="bg-status-vermelho" sub="Requer acao imediata" trend={-15} trendLabel="vs. mes anterior" />
        <StatCard title="Vencendo em 15 dias" value={contagem.AMARELO} icon={Clock} iconBg="bg-status-amarelo" sub="Planejamento de renovacao" />
        <StatCard title="Em Dia" value={contagem.VERDE} icon={CheckCircle2} iconBg="bg-status-verde" sub="Documentacao regularizada" />
      </div>

      <div className="card p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1 max-w-xl">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} className="input pl-9" placeholder="Buscar por TAG, placa ou tipo de documento..." />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0">
          {[
            { k: 'todos', l: 'Todos', c: 'bg-omega-900' },
            { k: 'VERMELHO', l: 'Vencidos', c: 'bg-status-vermelho' },
            { k: 'AMARELO', l: 'Atencao', c: 'bg-status-amarelo' },
            { k: 'VERDE', l: 'Em dia', c: 'bg-status-verde' },
          ].map(f => (
            <button
              key={f.k}
              onClick={() => setFiltroFarol(f.k)}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                filtroFarol === f.k ? `${f.c} text-white` : 'bg-omega-100 text-omega-700 hover:bg-omega-200'
              }`}
            >
              {f.l}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-omega-50 text-left text-xs uppercase tracking-wider text-omega-500 font-semibold">
              <tr>
                <th className="px-5 py-3">TAG / Placa</th>
                <th className="px-5 py-3">Veiculo</th>
                <th className="px-5 py-3">Documento</th>
                <th className="px-5 py-3">Validade</th>
                <th className="px-5 py-3">Dias Restantes</th>
                <th className="px-5 py-3">Farol</th>
                <th className="px-5 py-3 text-right">Anexo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-omega-100">
              {filtrados.map(d => (
                <tr key={d.id} className="hover:bg-omega-50">
                  <td className="px-5 py-3.5">
                    <div className="font-bold text-omega-900">{d.tag}</div>
                    <div className="text-xs text-omega-500 font-mono">{d.placa}</div>
                  </td>
                  <td className="px-5 py-3.5 text-omega-700">{d.modelo || '—'}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-omega-500" />
                      <span className="text-omega-800 font-medium">{d.documento}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 tabular-nums text-omega-700">{new Date(d.validade).toLocaleDateString('pt-BR')}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-sm font-bold tabular-nums ${d.dias < 0 ? 'text-status-vermelho' : d.dias < 15 ? 'text-status-amarelo' : 'text-status-verde'}`}>
                      {d.dias < 0 ? `${Math.abs(d.dias)} dias atrasado` : `${d.dias} dias`}
                    </span>
                  </td>
                  <td className="px-5 py-3.5"><BadgeStatus status={d.status} /></td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => setModalAnexo(d)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-omega-200 bg-white hover:bg-omega-50 text-omega-700 text-xs font-semibold"
                    >
                      <Paperclip size={12} /> Visualizar
                    </button>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-omega-500">Nenhum documento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!modalAnexo}
        onClose={() => setModalAnexo(null)}
        title={modalAnexo?.documento || ''}
        subtitle={modalAnexo ? `${modalAnexo.tag} • ${modalAnexo.placa} • Validade ${new Date(modalAnexo.validade).toLocaleDateString('pt-BR')}` : ''}
        size="lg"
        footer={
          <button onClick={() => window.open('#', '_blank')} className="btn-primary">
            <ExternalLink size={14} /> Abrir em nova aba
          </button>
        }
      >
        <div className="aspect-video w-full bg-omega-100 rounded-xl border border-omega-200 flex items-center justify-center text-omega-500">
          <div className="text-center p-6">
            <FileText size={56} className="mx-auto mb-3 opacity-50" />
            <p className="font-semibold">Visualizacao do documento</p>
            <p className="text-xs mt-1">PDF ou imagem do anexo sera exibido aqui.</p>
          </div>
        </div>
      </Modal>

      <Modal
        open={modalNovo}
        onClose={() => setModalNovo(false)}
        title="Adicionar Novo Documento"
        subtitle="Vincule um documento a um veiculo existente"
        size="md"
        footer={
          <>
            <button onClick={() => setModalNovo(false)} className="btn-secondary">Cancelar</button>
            <button onClick={() => setModalNovo(false)} className="btn-primary">Salvar documento</button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Veiculo (TAG)</label>
            <select className="input">
              {veiculos.map(v => <option key={v.tag}>{v.tag} - {v.placa}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Tipo de Documento</label>
            <select className="input">
              <option>CRLV</option>
              <option>Laudo de Elevacao</option>
              <option>ART</option>
              <option>Seguro</option>
              <option>Laudo Operacional</option>
            </select>
          </div>
          <div>
            <label className="label">Data de Validade</label>
            <input type="date" className="input" />
          </div>
          <div>
            <label className="label">Anexar arquivo (URL)</label>
            <input className="input" placeholder="https://..." />
          </div>
        </div>
      </Modal>
    </div>
  );
}
