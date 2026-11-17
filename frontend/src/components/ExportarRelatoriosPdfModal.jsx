import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, FolderArchive, Loader2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { hojeISO } from '../utils/datas.js';
import { STATUS_RELATORIOS_PDF, validarPeriodoRelatorios } from '../utils/relatoriosPeriodo.js';

export default function ExportarRelatoriosPdfModal({ sessao, dataInicial, onFechar, onConcluido }) {
  const hoje = hojeISO();
  const [dataInicio, setDataInicio] = useState(dataInicial || `${hoje.slice(0, 7)}-01`);
  const [dataFim, setDataFim] = useState(dataInicial || hoje);
  const [statuses, setStatuses] = useState([...STATUS_RELATORIOS_PDF]);
  const [exportando, setExportando] = useState(false);
  const [erro, setErro] = useState('');
  const [progresso, setProgresso] = useState(null);
  const controllerRef = useRef(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const exportar = async (evento) => {
    evento.preventDefault();
    if (controllerRef.current) return;
    const periodo = {
      dataInicio, dataFim,
      statuses: statuses.length === STATUS_RELATORIOS_PDF.length ? undefined : statuses,
    };
    try {
      validarPeriodoRelatorios(periodo);
    } catch (falha) {
      setErro(falha.message);
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setExportando(true);
    setErro('');
    setProgresso({ etapa: 'consulta', total: 0, concluidos: 0 });
    try {
      const { exportarRelatoriosPdf } = await import('../utils/exportarRelatoriosPdf.js');
      const resultado = await exportarRelatoriosPdf(sessao, periodo, {
        signal: controller.signal,
        onProgresso: (atual) => { if (!controller.signal.aborted) setProgresso(atual); },
      });
      if (!controller.signal.aborted) onConcluido(resultado);
    } catch (falha) {
      if (!controller.signal.aborted) setErro(falha.message || 'Não foi possível exportar os relatórios. Tente novamente.');
    } finally {
      controllerRef.current = null;
      if (!controller.signal.aborted) {
        setExportando(false);
        setProgresso(null);
      }
    }
  };

  const fechar = () => {
    controllerRef.current?.abort();
    onFechar();
  };
  const percentual = progresso?.etapa === 'compactando' ? progresso.percentual || 0
    : progresso?.total ? Math.round((progresso.concluidos / progresso.total) * 100) : 0;
  const mensagem = progresso?.etapa === 'compactando'
    ? `Preparando ZIP: ${percentual}%`
    : progresso?.etapa === 'carregando'
      ? `Carregando relatórios ${progresso.concluidos + 1} a ${progresso.ate} de ${progresso.total}`
    : progresso?.etapa === 'gerando'
      ? `Gerando PDF ${Math.min(progresso.concluidos + 1, progresso.total)} de ${progresso.total}`
      : 'Buscando todos os relatórios do período...';

  return (
    <Modal open onClose={fechar} title="Baixar relatórios oficiais"
      subtitle="Um PDF por relatório, organizado em pastas por obra dentro de um ZIP."
      footer={<>
        <button type="button" onClick={fechar} className="btn-secondary">
          {exportando ? 'Cancelar exportação' : 'Cancelar'}
        </button>
        <button type="submit" form="exportar-relatorios-pdf" disabled={exportando}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
          {exportando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {exportando ? 'Exportando...' : 'Baixar PDFs por obra'}
        </button>
      </>}>
      <form id="exportar-relatorios-pdf" onSubmit={exportar} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm font-semibold text-omega-700">
            Data inicial
            <input type="date" required value={dataInicio} max={dataFim || undefined} disabled={exportando}
              onChange={(evento) => setDataInicio(evento.target.value)} className="input mt-1" />
          </label>
          <label className="block text-sm font-semibold text-omega-700">
            Data final
            <input type="date" required value={dataFim} min={dataInicio || undefined} disabled={exportando}
              onChange={(evento) => setDataFim(evento.target.value)} className="input mt-1" />
          </label>
        </div>
        <fieldset disabled={exportando} className="space-y-2">
          <legend className="text-sm font-semibold text-omega-700">Status dos relatórios</legend>
          <button type="button" className="text-sm font-semibold text-omega-accent disabled:opacity-50"
            onClick={() => setStatuses(statuses.length === STATUS_RELATORIOS_PDF.length ? [] : [...STATUS_RELATORIOS_PDF])}>
            {statuses.length === STATUS_RELATORIOS_PDF.length ? 'Limpar seleção' : 'Selecionar todos'}
          </button>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {STATUS_RELATORIOS_PDF.map((status) => <label key={status}
              className="flex items-center gap-2 rounded-xl border border-omega-200 px-3 py-2 text-sm text-omega-700">
              <input type="checkbox" checked={statuses.includes(status)} disabled={exportando}
                onChange={(evento) => setStatuses((atuais) => evento.target.checked
                  ? [...atuais, status] : atuais.filter((atual) => atual !== status))}
                className="h-4 w-4 shrink-0 accent-omega-accent" />
              {status}
            </label>)}
          </div>
        </fieldset>
        <div className="rounded-xl border border-omega-200 bg-omega-50 p-3 flex gap-3 text-sm text-omega-700">
          <FolderArchive size={21} className="shrink-0 text-omega-accent" />
          <div className="space-y-1">
            <p>Inclui as duas datas e os status selecionados, com fotos e assinaturas.</p>
            <p>Os filtros da tabela não limitam o download. Relatórios sem obra ficam na pasta “Sem obra”.</p>
            {sessao?.usuario?.tipo === 'OPERACIONAL' && <p>Serão incluídos somente os seus relatórios.</p>}
          </div>
        </div>
        {exportando && <div role="status" aria-live="polite" className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-omega-900">
            <Loader2 size={16} className="animate-spin shrink-0" /> {mensagem}
          </div>
          {progresso?.obra && <p className="text-xs text-omega-500 break-words">
            {progresso.obra}{progresso.tag ? ` • ${progresso.tag}` : ''}
          </p>}
          <div role="progressbar" aria-label={mensagem} aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={progresso?.total ? percentual : undefined}
            className="h-2 overflow-hidden rounded-full bg-omega-100">
            <div className={`h-full bg-omega-accent transition-all ${progresso?.total ? '' : 'animate-pulse'}`}
              style={{ width: progresso?.total ? `${percentual}%` : '30%' }} />
          </div>
          <p className="text-xs text-omega-500">Mantenha esta página aberta até o download terminar.</p>
        </div>}
        {erro && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2">
          <AlertTriangle size={17} className="shrink-0 mt-0.5" /> <span>{erro}</span>
        </div>}
      </form>
    </Modal>
  );
}
