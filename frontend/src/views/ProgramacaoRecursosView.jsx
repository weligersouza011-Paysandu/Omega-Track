import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Building2, CalendarDays, CheckCircle2, ChevronLeft,
  ChevronRight, Clock3, Copy, FileDown, RefreshCw, Save, Search, Truck, Wrench,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import ObraSearchSelect from '../components/ObraSearchSelect.jsx';
import PessoaSearchSelect from '../components/PessoaSearchSelect.jsx';
import { authHeaders } from '../utils/sessao.js';
import { ehMaster, podeEscrever } from '../utils/permissoes.js';

function dataLocal(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function moverDia(valor, quantidade) {
  const [ano, mes, dia] = valor.split('-').map(Number);
  return dataLocal(new Date(ano, mes - 1, dia + quantidade, 12));
}

function dataPorExtenso(valor) {
  const [ano, mes, dia] = valor.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(ano, mes - 1, dia, 12));
}

function dataHora(valor) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(valor));
}

function dataCurta(valor) {
  if (!valor) return '';
  const [ano, mes, dia] = valor.split('-');
  return `${dia}/${mes}/${ano}`;
}

export default function ProgramacaoRecursosView({ sessao }) {
  const [dia, setDia] = useState(() => dataLocal());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [alteracoes, setAlteracoes] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState('');
  const [mensagemSalvar, setMensagemSalvar] = useState('');
  const [mudancaPendente, setMudancaPendente] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [obraFiltro, setObraFiltro] = useState('');
  const [versao, setVersao] = useState(0);
  const [copiando, setCopiando] = useState(false);
  const [confirmarCopia, setConfirmarCopia] = useState(false);
  const [erroCopia, setErroCopia] = useState('');
  const [mensagemCopia, setMensagemCopia] = useState('');
  const [exportandoPdf, setExportandoPdf] = useState(false);
  const [erroPdf, setErroPdf] = useState('');
  const [manutencaoModal, setManutencaoModal] = useState(null);
  const [salvandoManutencao, setSalvandoManutencao] = useState(false);
  const [erroManutencao, setErroManutencao] = useState('');
  const [mensagemManutencao, setMensagemManutencao] = useState('');
  const podeGerenciar = ehMaster(sessao?.usuario) || podeEscrever(sessao?.usuario, 'programacao-recursos');

  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    setErro('');

    fetch(`/api/programacao-recursos?data=${encodeURIComponent(dia)}`, {
      headers: authHeaders(sessao),
      signal: controller.signal,
    })
      .then(async (resposta) => {
        const corpo = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(corpo.message || `Erro da API (${resposta.status})`);
        setDados(corpo.data);
      })
      .catch((falha) => {
        if (falha.name !== 'AbortError') setErro(falha.message || 'Não foi possível carregar a programação.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });

    return () => controller.abort();
  }, [dia, sessao, versao]);

  const totalAlteracoes = Object.keys(alteracoes).length;
  useLayoutEffect(() => {
    if (!totalAlteracoes) return undefined;
    const avisar = (evento) => {
      evento.preventDefault();
      // O navegador escolhe o texto do aviso; returnValue mantém suporte
      // aos navegadores que ainda exigem essa propriedade.
      evento.returnValue = 'Há alterações de programação não salvas.';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [totalAlteracoes]);

  useEffect(() => {
    if (!totalAlteracoes) return undefined;
    const confirmarSaida = (evento) => {
      if (evento.defaultPrevented || evento.button !== 0 || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;
      const link = evento.target instanceof Element ? evento.target.closest('a[href]') : null;
      if (!link || link.target === '_blank') return;
      const destino = new URL(link.href, window.location.href);
      if (destino.origin !== window.location.origin ||
          (destino.pathname === window.location.pathname && destino.search === window.location.search)) return;
      if (!window.confirm('Há alterações de programação não salvas. Deseja sair sem salvar?')) {
        evento.preventDefault();
        evento.stopPropagation();
      }
    };
    document.addEventListener('click', confirmarSaida, true);
    return () => document.removeEventListener('click', confirmarSaida, true);
  }, [totalAlteracoes]);

  const dadosDoDia = dados?.data === dia ? dados : null;
  const equipamentos = dadosDoDia?.equipamentos || [];
  const pessoas = dadosDoDia?.pessoas || [];
  const pessoasPorMatricula = new Map(pessoas.map((pessoa) => [pessoa.matricula, pessoa]));
  const equipamentosEditados = equipamentos.map((equipamento) => {
    const editado = alteracoes[equipamento.tag];
    if (!editado || equipamento.manutencaoAtiva) return equipamento;
    return {
      ...equipamento,
      ...editado,
      operadorNome: editado.operadorMatricula
        ? pessoasPorMatricula.get(editado.operadorMatricula)?.nome || equipamento.operadorNome : null,
      supervisorNome: editado.supervisorMatricula
        ? pessoasPorMatricula.get(editado.supervisorMatricula)?.nome || equipamento.supervisorNome : null,
    };
  });
  const obras = dadosDoDia?.obras || [];
  const obrasAtivas = obras.filter((obra) => obra.ativo);
  const totalAtribuidos = equipamentosEditados.filter((equipamento) => equipamento.obraId).length;
  const totalProgramados = equipamentosEditados.filter((equipamento) => equipamento.obraId && !equipamento.manutencaoAtiva).length;
  const totalManutencao = equipamentos.filter((equipamento) => equipamento.manutencaoAtiva).length;
  const totalLivres = equipamentosEditados.length - totalProgramados - totalManutencao;
  const totalUltima = dadosDoDia?.ultimaProgramacao?.totalProgramados || 0;
  const dataUltima = dadosDoDia?.ultimaProgramacao?.data || null;
  const obrasEmUso = new Set(equipamentosEditados.filter((equipamento) => !equipamento.manutencaoAtiva)
    .map((equipamento) => equipamento.obraId).filter(Boolean)).size;

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    return equipamentosEditados.filter((equipamento) => {
      if (filtro === 'programados' && (!equipamento.obraId || equipamento.manutencaoAtiva)) return false;
      if (filtro === 'livres' && (equipamento.obraId || equipamento.manutencaoAtiva)) return false;
      if (filtro === 'manutencao' && !equipamento.manutencaoAtiva) return false;
      if (obraFiltro && equipamento.obraId !== obraFiltro) return false;
      if (!termo) return true;
      return [equipamento.tag, equipamento.placa, equipamento.modelo, equipamento.contrato,
        equipamento.operadorNome, equipamento.operadorMatricula,
        equipamento.supervisorNome, equipamento.supervisorMatricula]
        .some((valor) => String(valor || '').toLocaleLowerCase('pt-BR').includes(termo));
    });
  }, [equipamentosEditados, busca, filtro, obraFiltro]);

  function alterarProgramacao(tag, mudanca) {
    if (!dadosDoDia || salvando || copiando || exportandoPdf || salvandoManutencao || !podeGerenciar) return;
    const original = equipamentos.find((equipamento) => equipamento.tag === tag);
    if (!original || original.manutencaoAtiva) return;
    setAlteracoes((atuais) => {
      const proximas = { ...atuais };
      const editado = {
        obraId: original.obraId || null,
        operadorMatricula: original.operadorMatricula || null,
        supervisorMatricula: original.supervisorMatricula || null,
        ...atuais[tag],
        ...mudanca,
      };
      if (!editado.obraId) {
        editado.operadorMatricula = null;
        editado.supervisorMatricula = null;
      }
      if (editado.obraId === (original.obraId || null) &&
          editado.operadorMatricula === (original.operadorMatricula || null) &&
          editado.supervisorMatricula === (original.supervisorMatricula || null)) {
        delete proximas[tag];
      } else proximas[tag] = editado;
      return proximas;
    });
    setErroSalvar('');
    setErroPdf('');
    setMensagemSalvar('');
  }

  async function salvarProgramacao() {
    if (!podeGerenciar || !dadosDoDia || !totalAlteracoes || salvando || copiando || exportandoPdf || salvandoManutencao) return;
    const alteracoesParaSalvar = Object.entries(alteracoes).map(([tag, valores]) => {
      const original = equipamentos.find((equipamento) => equipamento.tag === tag);
      const alteracao = { tag, obraId: valores.obraId };
      if (valores.operadorMatricula !== (original?.operadorMatricula || null)) {
        alteracao.operadorMatricula = valores.operadorMatricula;
      }
      if (valores.supervisorMatricula !== (original?.supervisorMatricula || null)) {
        alteracao.supervisorMatricula = valores.supervisorMatricula;
      }
      return alteracao;
    });
    setSalvando(true);
    setErroSalvar('');
    setMensagemSalvar('');
    try {
      const resposta = await fetch('/api/programacao-recursos/lote', {
        method: 'PUT',
        headers: authHeaders(sessao),
        body: JSON.stringify({ data: dia, alteracoes: alteracoesParaSalvar }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.message || `Erro ao salvar (${resposta.status})`);
      setMensagemSalvar(`${corpo.data.salvas} alteração(ões) salvas em ${dataCurta(dia)}.`);
      setAlteracoes({});
      setDados(null);
      setVersao((atual) => atual + 1);
    } catch (falha) {
      setErroSalvar(falha.message || 'Não foi possível salvar a programação.');
    } finally {
      setSalvando(false);
    }
  }

  const aplicarDia = (proximo) => {
    setAlteracoes({});
    setDia(proximo);
    setObraFiltro('');
    setErroCopia('');
    setMensagemCopia('');
    setErroSalvar('');
    setErroPdf('');
    setMensagemSalvar('');
    setMudancaPendente(null);
  };

  const mudarDia = (proximo) => {
    if (!proximo || proximo === dia || salvando || copiando || exportandoPdf) return;
    if (totalAlteracoes) setMudancaPendente(proximo);
    else aplicarDia(proximo);
  };

  async function copiarUltima() {
    if (!podeGerenciar || !dadosDoDia || !totalUltima || totalAlteracoes || salvando || copiando || exportandoPdf || salvandoManutencao) return;
    setConfirmarCopia(false);
    setErroCopia('');
    setMensagemCopia('');
    setCopiando(true);
    try {
      const resposta = await fetch('/api/programacao-recursos/copiar-ultima-programacao', {
        method: 'POST',
        headers: authHeaders(sessao),
        body: JSON.stringify({ data: dia, origemEsperada: dataUltima }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.message || `Erro ao copiar (${resposta.status})`);
      setMensagemCopia(
        `${corpo.data.copiados} equipamento(s) copiado(s) de ${dataCurta(corpo.data.origem)} para ${dataCurta(dia)}.` +
        (corpo.data.ignoradosManutencao ? ` ${corpo.data.ignoradosManutencao} em manutenção foram ignorados.` : '')
      );
      setDados(null);
      setVersao((atual) => atual + 1);
    } catch (falha) {
      setErroCopia(falha.message || 'Não foi possível copiar a programação.');
    } finally {
      setCopiando(false);
    }
  }

  async function exportarPdf() {
    if (!dadosDoDia || carregando || totalAlteracoes || salvando || copiando || exportandoPdf) return;
    setExportandoPdf(true);
    setErroPdf('');
    try {
      const resposta = await fetch(`/api/programacao-recursos?data=${encodeURIComponent(dia)}`, {
        headers: authHeaders(sessao),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.message || `Erro ao consultar a programação (${resposta.status})`);
      const { exportarProgramacaoPdf } = await import('../utils/exportarProgramacaoPdf.js');
      exportarProgramacaoPdf(corpo.data);
    } catch (falha) {
      setErroPdf(falha.message || 'Não foi possível gerar o PDF da programação.');
    } finally {
      setExportandoPdf(false);
    }
  }

  function abrirManutencao(equipamento) {
    if (!podeGerenciar || totalAlteracoes || salvando || copiando || exportandoPdf || salvandoManutencao) return;
    setErroManutencao('');
    setMensagemManutencao('');
    const manutencao = equipamento.manutencaoAtiva;
    setManutencaoModal({
      tag: equipamento.tag,
      modelo: equipamento.modelo || 'Equipamento',
      id: manutencao?.id || null,
      modo: manutencao ? 'retorno' : 'saida',
      tipo: manutencao?.tipo || 'PREVENTIVA',
      dataSaida: manutencao?.dataSaida || dataLocal(),
      previsaoRetorno: manutencao?.previsaoRetorno || dataLocal(),
      descricao: manutencao?.descricao || '',
      dataRetorno: dataLocal(),
    });
  }

  async function gravarManutencao() {
    if (!manutencaoModal || salvandoManutencao) return;
    const retorno = manutencaoModal.modo === 'retorno';
    if (!retorno && (!manutencaoModal.descricao.trim() ||
        manutencaoModal.previsaoRetorno < manutencaoModal.dataSaida ||
        manutencaoModal.dataSaida > dataLocal())) {
      setErroManutencao('Preencha a descrição e confira as datas de saída e previsão de retorno.');
      return;
    }
    if (retorno && (manutencaoModal.dataRetorno < manutencaoModal.dataSaida ||
        manutencaoModal.dataRetorno > dataLocal())) {
      setErroManutencao('A data de retorno deve ser entre a saída e hoje.');
      return;
    }
    setSalvandoManutencao(true);
    setErroManutencao('');
    try {
      const resposta = await fetch(retorno
        ? `/api/programacao-recursos/manutencoes/${encodeURIComponent(manutencaoModal.id)}/retorno`
        : '/api/programacao-recursos/manutencoes', {
        method: retorno ? 'PATCH' : 'POST',
        headers: authHeaders(sessao),
        body: JSON.stringify(retorno
          ? { dataRetorno: manutencaoModal.dataRetorno }
          : {
            tag: manutencaoModal.tag, tipo: manutencaoModal.tipo,
            dataSaida: manutencaoModal.dataSaida,
            previsaoRetorno: manutencaoModal.previsaoRetorno,
            descricao: manutencaoModal.descricao.trim(),
          }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.message || `Erro ao registrar manutenção (${resposta.status})`);
      setMensagemManutencao(retorno
        ? `Retorno de ${manutencaoModal.tag} registrado. A programação foi liberada.`
        : `${manutencaoModal.tag} enviado para manutenção. A programação ficou bloqueada até o retorno.`);
      setManutencaoModal(null);
      setDados(null);
      setVersao((atual) => atual + 1);
    } catch (falha) {
      setErroManutencao(falha.message || 'Não foi possível registrar a manutenção.');
    } finally {
      setSalvandoManutencao(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Transporte</div>
          <h1 className="mt-0.5 text-xl font-extrabold text-omega-900 tracking-tight sm:text-2xl">
            Programação de Recursos
          </h1>
          <p className="mt-1 text-sm text-omega-500">
            Defina a obra de cada equipamento em cada dia e salve as alterações quando terminar.
            {!podeGerenciar && ' Seu acesso é somente de leitura.'}
          </p>
        </div>

        <div className="card w-full shrink-0 p-3 sm:w-fit lg:w-[340px]">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-omega-100 text-omega-accent flex items-center justify-center shrink-0">
              <CalendarDays size={17} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-bold text-omega-400">Dia selecionado</div>
              <div className="text-sm font-bold text-omega-900 capitalize leading-tight">{dataPorExtenso(dia)}</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => mudarDia(moverDia(dia, -1))} disabled={salvando || copiando || exportandoPdf}
              className="btn-secondary !p-1.5" title="Dia anterior" aria-label="Dia anterior">
              <ChevronLeft size={16} />
            </button>
            <input type="date" value={dia} onChange={(evento) => mudarDia(evento.target.value)}
              disabled={salvando || copiando || exportandoPdf} aria-label="Selecionar dia da programação"
              className="input !w-auto !px-2 !py-1.5 !text-xs" />
            <button type="button" onClick={() => mudarDia(moverDia(dia, 1))} disabled={salvando || copiando || exportandoPdf}
              className="btn-secondary !p-1.5" title="Próximo dia" aria-label="Próximo dia">
              <ChevronRight size={16} />
            </button>
            <button type="button" onClick={() => mudarDia(dataLocal())} disabled={salvando || copiando || exportandoPdf}
              className="btn-secondary !px-2 !py-1.5 !text-xs">Hoje</button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {podeGerenciar && (
          <button type="button" className="btn-primary"
            onClick={salvarProgramacao}
            disabled={carregando || !dadosDoDia || totalAlteracoes === 0 || salvando || copiando || exportandoPdf}>
            {salvando ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            {salvando ? 'Salvando...' : 'Salvar programação'}
          </button>
        )}
        {podeGerenciar && (
          <button type="button" className="btn-secondary"
            onClick={() => totalAtribuidos > 0 ? setConfirmarCopia(true) : copiarUltima()}
            disabled={carregando || !dadosDoDia || totalUltima === 0 || totalAlteracoes > 0 || salvando || copiando || exportandoPdf}>
            {copiando ? <RefreshCw size={16} className="animate-spin" /> : <Copy size={16} />}
            {copiando ? 'Copiando...' : 'Copiar última programação'}
          </button>
        )}
        <button type="button" className="btn-secondary"
          onClick={exportarPdf}
          disabled={carregando || !dadosDoDia || totalAlteracoes > 0 || salvando || copiando || exportandoPdf}
          title={totalAlteracoes > 0 ? 'Salve ou descarte as alterações antes de exportar.' : 'Baixar a programação salva em PDF'}>
          {exportandoPdf ? <RefreshCw size={16} className="animate-spin" /> : <FileDown size={16} />}
          {exportandoPdf ? 'Gerando PDF...' : 'Exportar PDF'}
        </button>
        {podeGerenciar && (
          <span className="text-xs text-omega-500">
            {totalAlteracoes > 0
              ? `${totalAlteracoes} alteração(ões) pendente(s). Salve ou descarte antes de copiar ou exportar.`
              : totalUltima > 0
              ? `Último dia programado: ${dataCurta(dataUltima)} · ${totalUltima} equipamento(s)`
              : 'Nenhuma programação anterior encontrada'}
          </span>
        )}
        {podeGerenciar && totalAlteracoes > 0 && (
          <button type="button" className="text-xs font-semibold text-omega-600 hover:underline"
            onClick={() => { setAlteracoes({}); setErroSalvar(''); }}>
            Descartar alterações
          </button>
        )}
      </div>
      {erroSalvar && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erroSalvar}
        </div>
      )}
      {mensagemSalvar && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {mensagemSalvar}
        </div>
      )}
      {erroCopia && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erroCopia}
        </div>
      )}
      {erroPdf && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erroPdf}
        </div>
      )}
      {mensagemCopia && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {mensagemCopia}
        </div>
      )}
      {mensagemManutencao && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {mensagemManutencao}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {[
          { titulo: 'Equipamentos', valor: equipamentos.length, icon: Truck, cor: 'text-omega-accent bg-omega-100' },
          { titulo: 'Programados', valor: totalProgramados, icon: CheckCircle2, cor: 'text-emerald-700 bg-emerald-50' },
          { titulo: 'Sem programação', valor: totalLivres, icon: Clock3, cor: 'text-amber-700 bg-amber-50' },
          { titulo: 'Em manutenção', valor: totalManutencao, icon: Wrench, cor: 'text-orange-700 bg-orange-50' },
        ].map(({ titulo, valor, icon: Icon, cor }) => (
          <div key={titulo} className="card p-2 sm:p-3 flex items-center gap-2 sm:gap-3">
            <span className={`hidden sm:flex h-9 w-9 shrink-0 rounded-lg items-center justify-center ${cor}`}><Icon size={18} /></span>
            <div className="min-w-0">
              <div className="text-[11px] sm:text-xs text-omega-500 leading-tight">{titulo}</div>
              <div className="text-lg font-extrabold text-omega-900">{valor}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-3 grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_15rem] gap-3 lg:items-center">
        <div className="relative col-span-2 lg:col-span-1 min-w-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
          <input className="input pl-9" value={busca} onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar TAG, placa, tipo ou contrato" aria-label="Buscar equipamentos" />
        </div>
        <select className="input min-w-0" value={filtro} onChange={(evento) => setFiltro(evento.target.value)}
          aria-label="Filtrar programação">
          <option value="todos">Todos</option>
          <option value="programados">Programados</option>
          <option value="livres">Sem programação</option>
          <option value="manutencao">Em manutenção</option>
        </select>
        <select className="input min-w-0" value={obraFiltro} onChange={(evento) => setObraFiltro(evento.target.value)}
          aria-label="Filtrar por obra">
          <option value="">Todas as obras</option>
          {obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.nome}</option>)}
        </select>
      </div>

      {!carregando && !erro && equipamentos.length > 0 && obrasAtivas.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex flex-wrap items-center gap-2">
          <AlertTriangle size={17} /> Cadastre ou ative uma obra para programar os equipamentos.
          <Link to="/obras" className="font-bold underline underline-offset-2">Abrir Obras</Link>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-omega-100 bg-omega-50/50 flex flex-wrap items-center gap-2">
          <Building2 size={16} className="text-omega-500" />
          <span className="text-sm font-bold text-omega-900">Alocação diária</span>
          <span className="text-xs text-omega-500 ml-auto">
            {visiveis.length} equipamento(s) · {obrasEmUso} obra(s) em uso
          </span>
        </div>

        <div className="md:max-h-[clamp(420px,calc(100dvh-240px),720px)] md:overflow-y-auto md:overscroll-contain md:[contain:paint]">
        {carregando || !dadosDoDia && !erro ? (
          <div className="p-10 flex items-center justify-center gap-2 text-sm text-omega-500">
            <RefreshCw size={18} className="animate-spin" /> Carregando programação...
          </div>
        ) : erro ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="mx-auto mb-2 text-amber-600" />
            <p className="text-sm text-omega-700 mb-3">{erro}</p>
            <button type="button" className="btn-secondary !py-2" onClick={() => setVersao((n) => n + 1)}>
              <RefreshCw size={15} /> Tentar novamente
            </button>
          </div>
        ) : equipamentos.length === 0 ? (
          <div className="p-10 text-center text-sm text-omega-500">
            Nenhum equipamento cadastrado. <Link to="/frota" className="text-omega-accent font-semibold hover:underline">Abrir frota</Link>
          </div>
        ) : visiveis.length === 0 ? (
          <div className="p-10 text-center text-sm text-omega-500">Nenhum equipamento corresponde aos filtros.</div>
        ) : (
          <div className="divide-y divide-omega-100">
            {visiveis.map((equipamento) => {
              const obraAtual = obras.find((obra) => obra.id === equipamento.obraId);
              return (
                <div key={equipamento.tag} className="p-4 space-y-3 hover:bg-omega-50/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-omega-900 break-words">{equipamento.modelo || 'Equipamento'}</div>
                      <div className="text-xs text-omega-500 mt-0.5">
                        <span className="font-mono font-semibold text-omega-700">{equipamento.tag}</span>
                        {' · '}{equipamento.placa || 'Sem placa'}
                        {equipamento.status && <span className="text-omega-400"> · {equipamento.status}</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => abrirManutencao(equipamento)}
                      disabled={!podeGerenciar || totalAlteracoes > 0 || salvando || copiando || exportandoPdf || salvandoManutencao}
                      title={totalAlteracoes ? 'Salve ou descarte as alterações antes de mudar o status.'
                        : equipamento.manutencaoAtiva ? 'Registrar retorno da manutenção' : 'Enviar para manutenção'}
                      aria-label={`${equipamento.tag}: ${equipamento.manutencaoAtiva
                        ? `Manutenção ${equipamento.manutencaoAtiva.tipo === 'PREVENTIVA' ? 'Preventiva' : 'Corretiva'}. Registrar retorno`
                        : 'Alterar status para manutenção'}`}
                      className={`chip shrink-0 inline-flex items-center gap-1.5 text-left max-w-[55%] sm:max-w-none ${equipamento.manutencaoAtiva
                        ? 'bg-orange-50 text-orange-800'
                        : Object.hasOwn(alteracoes, equipamento.tag) ? 'bg-amber-50 text-amber-700'
                        : equipamento.obraId ? 'bg-emerald-50 text-emerald-700' : 'bg-omega-100 text-omega-600'} ${podeGerenciar ? 'hover:ring-2 hover:ring-omega-200 disabled:cursor-not-allowed' : ''}`}>
                      {equipamento.manutencaoAtiva && <Wrench size={13} className="shrink-0" />}
                      <span className="truncate">{equipamento.manutencaoAtiva
                        ? `Manutenção ${equipamento.manutencaoAtiva.tipo === 'PREVENTIVA' ? 'Preventiva' : 'Corretiva'}`
                        : Object.hasOwn(alteracoes, equipamento.tag) ? 'Pendente'
                        : equipamento.obraId ? 'Programado' : 'Livre'}</span>
                    </button>
                  </div>
                  {equipamento.manutencaoAtiva && (
                    <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900 space-y-1">
                      <p className="font-semibold">Saída: {dataCurta(equipamento.manutencaoAtiva.dataSaida)} · Previsão de retorno: {dataCurta(equipamento.manutencaoAtiva.previsaoRetorno)}</p>
                      <p className="whitespace-pre-wrap break-words">{equipamento.manutencaoAtiva.descricao}</p>
                      <p>Programação bloqueada até registrar o retorno pelo status acima.</p>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3">
                    <div className="min-w-0 sm:col-span-2 xl:col-span-1">
                      <label htmlFor={`obra-${equipamento.tag}`} className="block mb-1 text-[11px] uppercase tracking-wider font-bold text-omega-500">
                        Obra programada
                      </label>
                      <ObraSearchSelect id={`obra-${equipamento.tag}`}
                        obraAtual={obraAtual} obrasAtivas={obrasAtivas}
                        onChange={(obraId) => alterarProgramacao(equipamento.tag, { obraId })}
                        disabled={!podeGerenciar || !!equipamento.manutencaoAtiva || salvando || copiando || exportandoPdf || carregando || (!obrasAtivas.length && !equipamento.obraId)} />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={`operador-${equipamento.tag}`} className="block mb-1 text-[11px] uppercase tracking-wider font-bold text-omega-500">Operador</label>
                      <PessoaSearchSelect id={`operador-${equipamento.tag}`} rotulo="operador"
                        matricula={equipamento.operadorMatricula} nomeSalvo={equipamento.operadorNome}
                        pessoas={pessoas} onChange={(operadorMatricula) => alterarProgramacao(equipamento.tag, { operadorMatricula })}
                        disabled={!podeGerenciar || !!equipamento.manutencaoAtiva || !equipamento.obraId || salvando || copiando || exportandoPdf || carregando} />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={`supervisor-${equipamento.tag}`} className="block mb-1 text-[11px] uppercase tracking-wider font-bold text-omega-500">Supervisor</label>
                      <PessoaSearchSelect id={`supervisor-${equipamento.tag}`} rotulo="supervisor"
                        matricula={equipamento.supervisorMatricula} nomeSalvo={equipamento.supervisorNome}
                        pessoas={pessoas} onChange={(supervisorMatricula) => alterarProgramacao(equipamento.tag, { supervisorMatricula })}
                        disabled={!podeGerenciar || !!equipamento.manutencaoAtiva || !equipamento.obraId || salvando || copiando || exportandoPdf || carregando} />
                    </div>
                  </div>
                  {Object.hasOwn(alteracoes, equipamento.tag) ? (
                    <p className="text-[11px] font-semibold text-amber-700">Alteração não salva</p>
                  ) : equipamento.atualizadoEm ? (
                    <p className="text-[11px] text-omega-400">Atualizado em {dataHora(equipamento.atualizadoEm)}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      <p className="text-xs text-omega-500">
        Cada equipamento pode estar em uma obra por dia, com operador e supervisor. As escolhas só são gravadas no banco ao clicar em “Salvar programação”.
        Escolha “Sem programação” para liberar o dia. Clique no status do equipamento para registrar manutenção ou retorno.
        O PDF inclui a programação salva de todos os equipamentos.
      </p>

      <Modal open={!!manutencaoModal} onClose={() => !salvandoManutencao && setManutencaoModal(null)}
        title={manutencaoModal?.modo === 'retorno' ? 'Registrar retorno da manutenção' : 'Enviar equipamento para manutenção'}
        subtitle={manutencaoModal ? `${manutencaoModal.modelo} · ${manutencaoModal.tag}` : ''}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={salvandoManutencao}
              onClick={() => setManutencaoModal(null)}>Cancelar</button>
            <button type="button" className="btn-primary" disabled={salvandoManutencao ||
              (manutencaoModal?.modo === 'retorno'
                ? !manutencaoModal?.dataRetorno || manutencaoModal.dataRetorno < manutencaoModal.dataSaida || manutencaoModal.dataRetorno > dataLocal()
                : !manutencaoModal?.dataSaida || !manutencaoModal?.previsaoRetorno || !manutencaoModal?.descricao.trim() ||
                  manutencaoModal.descricao.length > 2000 || manutencaoModal.previsaoRetorno < manutencaoModal.dataSaida ||
                  manutencaoModal.dataSaida > dataLocal())}
              onClick={gravarManutencao}>
              {salvandoManutencao ? <RefreshCw size={16} className="animate-spin" /> : <Wrench size={16} />}
              {manutencaoModal?.modo === 'retorno' ? 'Confirmar retorno' : 'Registrar saída'}
            </button>
          </>
        }>
        {manutencaoModal?.modo === 'retorno' ? (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-orange-900">
              <p className="font-semibold">Manutenção {manutencaoModal.tipo === 'PREVENTIVA' ? 'Preventiva' : 'Corretiva'}</p>
              <p>Saída: {dataCurta(manutencaoModal.dataSaida)} · Previsão: {dataCurta(manutencaoModal.previsaoRetorno)}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{manutencaoModal.descricao}</p>
            </div>
            <div>
              <label htmlFor="data-retorno-manutencao" className="block mb-1 font-semibold text-omega-700">Data real do retorno</label>
              <input id="data-retorno-manutencao" type="date" className="input" required
                min={manutencaoModal.dataSaida} max={dataLocal()} value={manutencaoModal.dataRetorno}
                onChange={(evento) => setManutencaoModal((atual) => ({ ...atual, dataRetorno: evento.target.value }))} />
            </div>
            <p className="text-omega-500">Ao confirmar, obra, operador e supervisor poderão ser editados novamente.</p>
          </div>
        ) : manutencaoModal ? (
          <div className="space-y-4 text-sm">
            <div>
              <label htmlFor="tipo-manutencao" className="block mb-1 font-semibold text-omega-700">Tipo de manutenção</label>
              <select id="tipo-manutencao" className="input" value={manutencaoModal.tipo}
                onChange={(evento) => setManutencaoModal((atual) => ({ ...atual, tipo: evento.target.value }))}>
                <option value="PREVENTIVA">Manutenção Preventiva</option>
                <option value="CORRETIVA">Manutenção Corretiva</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="data-saida-manutencao" className="block mb-1 font-semibold text-omega-700">Data de saída</label>
                <input id="data-saida-manutencao" type="date" className="input" required max={dataLocal()}
                  value={manutencaoModal.dataSaida}
                  onChange={(evento) => setManutencaoModal((atual) => ({ ...atual, dataSaida: evento.target.value }))} />
              </div>
              <div>
                <label htmlFor="previsao-retorno-manutencao" className="block mb-1 font-semibold text-omega-700">Previsão de retorno</label>
                <input id="previsao-retorno-manutencao" type="date" className="input" required
                  min={manutencaoModal.dataSaida} value={manutencaoModal.previsaoRetorno}
                  onChange={(evento) => setManutencaoModal((atual) => ({ ...atual, previsaoRetorno: evento.target.value }))} />
              </div>
            </div>
            <div>
              <label htmlFor="descricao-manutencao" className="block mb-1 font-semibold text-omega-700">O que o equipamento foi resolver?</label>
              <textarea id="descricao-manutencao" className="input min-h-28 resize-y" required maxLength={2000}
                placeholder="Descreva o problema, a revisão ou o serviço previsto."
                value={manutencaoModal.descricao}
                onChange={(evento) => setManutencaoModal((atual) => ({ ...atual, descricao: evento.target.value }))} />
              <p className="mt-1 text-xs text-omega-400">{manutencaoModal.descricao.length}/2000 caracteres</p>
            </div>
            <p className="text-omega-500">Após registrar a saída, a programação deste equipamento ficará bloqueada até o retorno.</p>
          </div>
        ) : null}
        {erroManutencao && <p role="alert" className="mt-3 text-sm text-red-700">{erroManutencao}</p>}
      </Modal>

      <Modal open={!!mudancaPendente} onClose={() => setMudancaPendente(null)}
        title="Descartar alterações não salvas?"
        subtitle={`Ir para ${dataCurta(mudancaPendente)}`}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setMudancaPendente(null)}>Continuar editando</button>
            <button type="button" className="btn-danger" onClick={() => aplicarDia(mudancaPendente)}>
              Descartar e mudar de dia
            </button>
          </>
        }>
        <p className="text-sm text-omega-700">
          Você tem {totalAlteracoes} alteração(ões) pendente(s). Elas não serão gravadas se mudar de dia agora.
        </p>
      </Modal>

      <Modal open={confirmarCopia} onClose={() => !copiando && setConfirmarCopia(false)}
        title="Substituir a programação deste dia?"
        subtitle={`Copiar ${dataCurta(dataUltima)} para ${dataCurta(dia)}`}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmarCopia(false)}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={copiarUltima}>
              <Copy size={16} /> Substituir e copiar
            </button>
          </>
        }>
        <p className="text-sm text-omega-700">
          As atribuições dos equipamentos disponíveis em {dataCurta(dia)} serão substituídas pelas de {dataCurta(dataUltima)}.
          Equipamentos que estavam sem programação nessa data ficarão livres no dia selecionado.
          Equipamentos em manutenção serão ignorados e manterão suas atribuições atuais.
        </p>
      </Modal>
    </div>
  );
}
