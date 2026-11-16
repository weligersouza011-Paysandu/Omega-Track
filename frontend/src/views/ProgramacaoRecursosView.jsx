import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Building2, Bus, CalendarDays, Car, CheckCircle2, ChevronDown, ChevronLeft,
  ChevronRight, ChevronsDownUp, ChevronsUpDown, Clock3, Construction, Copy, FileDown, Package,
  RefreshCw, Save, Search, Tractor, Truck, Wrench, X,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import ObraSearchSelect from '../components/ObraSearchSelect.jsx';
import PessoaSearchSelect from '../components/PessoaSearchSelect.jsx';
import { authHeaders } from '../utils/sessao.js';
import { ehMaster, podeEscrever } from '../utils/permissoes.js';
import { agruparPorCategoria, categoriaDo, matizesDasObras } from '../utils/categoriasProgramacao.js';
import { EVENTO_SINCRONIZADO, MENSAGEM_SALVO_LOCAL, mensagemFalha, salvoNaFila } from '../offline/index.js';

const ICONES_CATEGORIA = {
  leve: Car, utilitario: Car, onibus: Bus, caminhao: Truck,
  guindaste: Construction, maquina: Tractor, outro: Package,
};

const FILTROS_RAPIDOS = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'livres', rotulo: 'Somente livres' },
  { chave: 'programados', rotulo: 'Programados' },
  { chave: 'manutencao', rotulo: 'Em manutenção' },
  { chave: 'proprios', rotulo: 'Frota própria' },
  { chave: 'terceiros', rotulo: 'Terceiros' },
];

// Foto 44x44 do veículo; sem foto (ou falha ao carregar) mostra o ícone da categoria.
function AvatarVeiculo({ fotoUrl, Icone }) {
  const [falhou, setFalhou] = useState(false);
  if (fotoUrl && !falhou) {
    return (
      <img src={fotoUrl} alt="" loading="lazy" onError={() => setFalhou(true)}
        className="h-11 w-11 shrink-0 rounded-xl object-cover bg-omega-100" />
    );
  }
  return (
    <span className="prog-avatar h-11 w-11 shrink-0 rounded-xl flex items-center justify-center" aria-hidden="true">
      <Icone size={20} strokeWidth={1.75} />
    </span>
  );
}

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
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [recolhidos, setRecolhidos] = useState(() => new Set());
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

  // Fila offline enviada: recarrega o dia com os dados oficiais do servidor
  // (só quando não há edições não salvas na tela, para não atropelar o usuário).
  useEffect(() => {
    const recarregar = () => { if (!totalAlteracoes) setVersao((atual) => atual + 1); };
    window.addEventListener(EVENTO_SINCRONIZADO, recarregar);
    return () => window.removeEventListener(EVENTO_SINCRONIZADO, recarregar);
  }, [totalAlteracoes]);
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

  const obrasPorId = new Map(obras.map((obra) => [obra.id, obra]));
  const matizPorObra = useMemo(() => matizesDasObras(obras), [obras]);
  const categorias = useMemo(
    () => agruparPorCategoria(equipamentos).map((grupo) => grupo.nome),
    [equipamentos]
  );
  const contagemFiltros = {
    todos: equipamentosEditados.length,
    livres: totalLivres,
    programados: totalProgramados,
    manutencao: totalManutencao,
    proprios: equipamentosEditados.filter((equipamento) => !equipamento.is_terceiro).length,
    terceiros: equipamentosEditados.filter((equipamento) => equipamento.is_terceiro).length,
  };

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    return equipamentosEditados.filter((equipamento) => {
      if (filtro === 'programados' && (!equipamento.obraId || equipamento.manutencaoAtiva)) return false;
      if (filtro === 'livres' && (equipamento.obraId || equipamento.manutencaoAtiva)) return false;
      if (filtro === 'manutencao' && !equipamento.manutencaoAtiva) return false;
      if (filtro === 'proprios' && equipamento.is_terceiro) return false;
      if (filtro === 'terceiros' && !equipamento.is_terceiro) return false;
      if (categoriaFiltro && categoriaDo(equipamento) !== categoriaFiltro) return false;
      if (obraFiltro && equipamento.obraId !== obraFiltro) return false;
      if (!termo) return true;
      return [equipamento.tag, equipamento.placa, equipamento.modelo, equipamento.contrato, equipamento.modeloVeiculo,
        obrasPorId.get(equipamento.obraId)?.nome,
        equipamento.operadorNome, equipamento.operadorMatricula,
        equipamento.supervisorNome, equipamento.supervisorMatricula]
        .some((valor) => String(valor || '').toLocaleLowerCase('pt-BR').includes(termo));
    });
  }, [equipamentosEditados, busca, filtro, categoriaFiltro, obraFiltro, obras]);
  const blocos = useMemo(() => agruparPorCategoria(visiveis), [visiveis]);
  const filtrando = Boolean(busca.trim() || filtro !== 'todos' || categoriaFiltro || obraFiltro);
  const ehHoje = dia === dataLocal();

  function alternarBloco(nome) {
    setRecolhidos((atuais) => {
      const proximos = new Set(atuais);
      if (proximos.has(nome)) proximos.delete(nome); else proximos.add(nome);
      return proximos;
    });
  }

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
      setMensagemSalvar(salvoNaFila(resposta)
        ? `${MENSAGEM_SALVO_LOCAL} (${corpo.data.salvas} alteração(ões) em ${dataCurta(dia)}).`
        : `${corpo.data.salvas} alteração(ões) salvas em ${dataCurta(dia)}.`);
      setAlteracoes({});
      setDados(null);
      setVersao((atual) => atual + 1);
    } catch (falha) {
      setErroSalvar(mensagemFalha(falha, 'Não foi possível salvar a programação.'));
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
      setErroCopia(mensagemFalha(falha, 'Não foi possível copiar a programação.'));
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
      await exportarProgramacaoPdf(corpo.data);
    } catch (falha) {
      setErroPdf(mensagemFalha(falha, 'Não foi possível gerar o PDF da programação.'));
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
      setErroManutencao(mensagemFalha(falha, 'Não foi possível registrar a manutenção.'));
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

        <div className={`card w-full shrink-0 p-3 sm:w-fit lg:w-[340px] ${ehHoje ? 'border-t-4 !border-t-omega-accent' : ''}`}>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-omega-100 text-omega-accent flex items-center justify-center shrink-0">
              <CalendarDays size={17} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-bold text-omega-400 flex items-center gap-1.5">
                Dia selecionado
                {ehHoje && <span className="rounded bg-omega-accent px-1.5 py-px text-[9px] text-white">HOJE</span>}
              </div>
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

      <div className="card p-3 space-y-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtros rápidos">
          {FILTROS_RAPIDOS.map(({ chave, rotulo }) => (
            <button key={chave} type="button" aria-pressed={filtro === chave}
              onClick={() => setFiltro(chave)}
              className="prog-chip-filtro inline-flex items-center gap-1.5 rounded-full border border-omega-200 px-3 py-1.5 text-xs font-semibold text-omega-700 hover:bg-omega-50 transition-colors">
              {rotulo}
              <span className="tabular-nums opacity-70">{contagemFiltros[chave]}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_15rem_auto] gap-2 lg:items-center">
          <div className="relative col-span-2 lg:col-span-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
            <input className="input pl-9" value={busca} onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar TAG, placa, obra, operador ou supervisor" aria-label="Buscar equipamentos" />
          </div>
          <select className="input min-w-0" value={categoriaFiltro} onChange={(evento) => setCategoriaFiltro(evento.target.value)}
            aria-label="Filtrar por categoria">
            <option value="">Todas as categorias</option>
            {categorias.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
          </select>
          <select className="input min-w-0" value={obraFiltro} onChange={(evento) => setObraFiltro(evento.target.value)}
            aria-label="Filtrar por obra">
            <option value="">Todas as obras</option>
            {obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.nome}</option>)}
          </select>
          {filtrando && (
            <button type="button" className="btn-secondary !py-2 text-xs col-span-2 lg:col-span-1 justify-center"
              onClick={() => { setBusca(''); setFiltro('todos'); setCategoriaFiltro(''); setObraFiltro(''); }}>
              <X size={14} /> Limpar
            </button>
          )}
        </div>
      </div>

      {!carregando && !erro && equipamentos.length > 0 && obrasAtivas.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex flex-wrap items-center gap-2">
          <AlertTriangle size={17} /> Cadastre ou ative uma obra para programar os equipamentos.
          <Link to="/obras" className="font-bold underline underline-offset-2">Abrir Obras</Link>
        </div>
      )}

      <div className={`card overflow-hidden ${ehHoje ? 'border-t-4 !border-t-omega-accent' : ''}`}>
        <div className="px-4 py-3 border-b border-omega-100 bg-omega-50/50 flex flex-wrap items-center gap-2">
          <Building2 size={16} className="text-omega-500" />
          <span className="text-sm font-bold text-omega-900">Alocação diária</span>
          {ehHoje && <span className="rounded bg-omega-accent px-1.5 py-px text-[10px] font-bold text-white">HOJE</span>}
          <span className="text-xs text-omega-500 ml-auto">
            {visiveis.length} equipamento(s) · {blocos.length} categoria(s) · {obrasEmUso} obra(s) em uso
          </span>
          {blocos.length > 1 && (
            <button type="button" className="btn-secondary !px-2 !py-1 !text-xs"
              onClick={() => setRecolhidos(recolhidos.size >= blocos.length ? new Set() : new Set(blocos.map((bloco) => bloco.nome)))}>
              {recolhidos.size >= blocos.length
                ? <><ChevronsUpDown size={14} /> Expandir todos</>
                : <><ChevronsDownUp size={14} /> Recolher todos</>}
            </button>
          )}
        </div>

        <div className="md:max-h-[clamp(420px,calc(100dvh-240px),760px)] md:overflow-y-auto md:overscroll-contain md:[contain:paint]">
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
            Nenhum equipamento mobilizado. <Link to="/frota" className="text-omega-accent font-semibold hover:underline">Abrir frota</Link>
          </div>
        ) : visiveis.length === 0 ? (
          <div className="p-10 text-center text-sm text-omega-500">Nenhum equipamento corresponde aos filtros.</div>
        ) : (
          <div className="p-2 sm:p-3 space-y-3">
            {blocos.map((bloco) => {
              const Icone = ICONES_CATEGORIA[bloco.icone] || Package;
              const recolhido = recolhidos.has(bloco.nome) && !busca.trim();
              const emManutencao = bloco.itens.filter((item) => item.manutencaoAtiva).length;
              const programados = bloco.itens.filter((item) => item.obraId && !item.manutencaoAtiva).length;
              const livres = bloco.itens.length - programados - emManutencao;
              const qtdTerceiros = bloco.itens.filter((item) => item.is_terceiro).length;
              const percentual = bloco.itens.length ? Math.round((programados / bloco.itens.length) * 100) : 0;
              return (
                <section key={bloco.nome} className="prog-bloco rounded-xl overflow-hidden" aria-label={bloco.nome}>
                  <button type="button" onClick={() => alternarBloco(bloco.nome)} aria-expanded={!recolhido}
                    className="prog-bloco-cabecalho w-full flex items-center gap-3 px-3 py-2.5 text-left">
                    <span className="h-9 w-9 shrink-0 rounded-lg bg-white text-omega-accent flex items-center justify-center shadow-sm">
                      <Icone size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-extrabold text-omega-900 truncate">{bloco.nome}</span>
                      <span className="block text-xs text-omega-500 tabular-nums">
                        {bloco.itens.length} veículo{bloco.itens.length === 1 ? '' : 's'}
                        {' • '}<span className="font-semibold text-emerald-700">{programados} programado{programados === 1 ? '' : 's'}</span>
                        {' / '}<span className={livres ? 'font-semibold text-amber-700' : ''}>{livres} livre{livres === 1 ? '' : 's'}</span>
                        {emManutencao > 0 && <> • <span className="font-semibold text-orange-700">{emManutencao} em manutenção</span></>}
                        {qtdTerceiros > 0 && <> • <span className="text-violet-700">{qtdTerceiros} terceiro{qtdTerceiros === 1 ? '' : 's'}</span></>}
                      </span>
                    </span>
                    <span className="hidden sm:block w-24 shrink-0" aria-hidden="true">
                      <span className="block h-1.5 rounded-full bg-omega-100 overflow-hidden">
                        <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${percentual}%` }} />
                      </span>
                      <span className="mt-0.5 block text-right text-[10px] font-bold text-omega-500 tabular-nums">{percentual}%</span>
                    </span>
                    <ChevronDown size={18} className={`shrink-0 text-omega-400 transition-transform ${recolhido ? '-rotate-90' : ''}`} />
                  </button>

                  {!recolhido && (
                    <div>
                      <div className="hidden lg:grid lg:grid-cols-[minmax(15rem,1.15fr)_minmax(14rem,1.35fr)_minmax(11rem,1fr)_minmax(11rem,1fr)_8.5rem] gap-3 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-omega-400">
                        <span>Veículo</span><span>Obra / frente</span><span>Operador</span><span>Supervisor</span><span className="text-right">Status</span>
                      </div>
                      {bloco.itens.map((equipamento) => {
                        const obraAtual = obrasPorId.get(equipamento.obraId);
                        const pendente = Object.hasOwn(alteracoes, equipamento.tag);
                        const manutencao = equipamento.manutencaoAtiva;
                        const travado = salvando || copiando || exportandoPdf || carregando;
                        const rotuloStatus = manutencao
                          ? `Manutenção ${manutencao.tipo === 'PREVENTIVA' ? 'Preventiva' : 'Corretiva'}`
                          : pendente ? 'Pendente' : equipamento.obraId ? 'Programado' : 'Livre';
                        const corStatus = manutencao ? 'bg-orange-50 text-orange-800'
                          : pendente ? 'bg-amber-50 text-amber-700'
                          : equipamento.obraId ? 'bg-emerald-50 text-emerald-700' : 'bg-omega-100 text-omega-600';
                        return (
                          <div key={equipamento.tag}
                            className={`prog-linha grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-3 py-2.5 lg:grid-cols-[minmax(15rem,1.15fr)_minmax(14rem,1.35fr)_minmax(11rem,1fr)_minmax(11rem,1fr)_8.5rem] lg:items-center ${pendente ? 'prog-linha-pendente' : ''}`}>
                            <div className="min-w-0 flex items-center gap-3 lg:order-1">
                              <AvatarVeiculo fotoUrl={equipamento.fotoUrl} Icone={Icone} />
                              <div className="min-w-0">
                                <span className="prog-tag inline-block rounded-md px-2 py-0.5 text-[15px] font-black leading-6">
                                  {equipamento.tag}
                                </span>
                                <div className="mt-0.5 text-xs text-omega-500 truncate">
                                  {[equipamento.is_terceiro ? equipamento.modeloVeiculo : null, equipamento.placa || 'Sem placa']
                                    .filter(Boolean).join(' · ')}
                                </div>
                                {equipamento.is_terceiro ? (
                                  <span className="mt-0.5 inline-block max-w-full truncate rounded bg-violet-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-violet-700"
                                    title="Veículo de empresa terceirizada (somente programação)">
                                    Terceiro{equipamento.empresaTerceira ? ` • ${equipamento.empresaTerceira}` : ''}
                                  </span>
                                ) : null}
                                {pendente ? (
                                  <span className="mt-0.5 block text-[10px] font-semibold text-amber-700">Alteração não salva</span>
                                ) : equipamento.pendenteSync ? (
                                  <span className="mt-0.5 block text-[10px] font-semibold text-blue-700">Salvo localmente • aguardando sincronização</span>
                                ) : !equipamento.is_terceiro && equipamento.atualizadoEm ? (
                                  <span className="mt-0.5 block text-[10px] text-omega-400">Atualizado em {dataHora(equipamento.atualizadoEm)}</span>
                                ) : null}
                              </div>
                            </div>

                            <div className="justify-self-end self-start lg:self-center lg:order-5">
                              {equipamento.is_terceiro ? (
                                <span className={`chip ${corStatus}`}>{rotuloStatus}</span>
                              ) : (
                                <button type="button" onClick={() => abrirManutencao(equipamento)}
                                  disabled={!podeGerenciar || totalAlteracoes > 0 || salvando || copiando || exportandoPdf || salvandoManutencao}
                                  title={totalAlteracoes ? 'Salve ou descarte as alterações antes de mudar o status.'
                                    : manutencao ? 'Registrar retorno da manutenção' : 'Enviar para manutenção'}
                                  aria-label={`${equipamento.tag}: ${manutencao ? `${rotuloStatus}. Registrar retorno` : 'Alterar status para manutenção'}`}
                                  className={`chip inline-flex items-center gap-1.5 text-left max-w-[9rem] ${corStatus} ${podeGerenciar ? 'hover:ring-2 hover:ring-omega-200 disabled:cursor-not-allowed' : ''}`}>
                                  {manutencao && <Wrench size={13} className="shrink-0" />}
                                  <span className="truncate">{rotuloStatus}</span>
                                </button>
                              )}
                            </div>

                            <div className="min-w-0 col-span-2 lg:col-span-1 lg:order-2">
                              <label htmlFor={`obra-${equipamento.tag}`} className="block mb-1 text-[10px] uppercase tracking-wider font-bold text-omega-500 lg:sr-only">
                                Obra / frente
                              </label>
                              <ObraSearchSelect id={`obra-${equipamento.tag}`}
                                obraAtual={obraAtual} obrasAtivas={obrasAtivas}
                                rotuloVazio={manutencao ? 'Bloqueado (manutenção)' : podeGerenciar ? '+ Alocar' : 'Livre'}
                                botaoClassName={`w-full min-h-[2.5rem] rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-2 text-left transition-colors disabled:cursor-not-allowed ${obraAtual ? 'prog-obra-pill font-semibold' : 'prog-obra-livre font-medium'} ${manutencao ? 'opacity-60' : ''}`}
                                botaoStyle={obraAtual ? { '--obra-h': matizPorObra.get(obraAtual.id) ?? 210 } : undefined}
                                onChange={(obraId) => alterarProgramacao(equipamento.tag, { obraId })}
                                disabled={!podeGerenciar || !!manutencao || travado || (!obrasAtivas.length && !equipamento.obraId)} />
                            </div>
                            <div className="min-w-0 col-span-2 sm:col-span-1 lg:order-3">
                              <label htmlFor={`operador-${equipamento.tag}`} className="block mb-1 text-[10px] uppercase tracking-wider font-bold text-omega-500 lg:sr-only">Operador</label>
                              <PessoaSearchSelect id={`operador-${equipamento.tag}`} rotulo="operador"
                                matricula={equipamento.operadorMatricula} nomeSalvo={equipamento.operadorNome}
                                pessoas={pessoas} onChange={(operadorMatricula) => alterarProgramacao(equipamento.tag, { operadorMatricula })}
                                disabled={!podeGerenciar || !!manutencao || !equipamento.obraId || travado} />
                            </div>
                            <div className="min-w-0 col-span-2 sm:col-span-1 lg:order-4">
                              <label htmlFor={`supervisor-${equipamento.tag}`} className="block mb-1 text-[10px] uppercase tracking-wider font-bold text-omega-500 lg:sr-only">Supervisor</label>
                              <PessoaSearchSelect id={`supervisor-${equipamento.tag}`} rotulo="supervisor"
                                matricula={equipamento.supervisorMatricula} nomeSalvo={equipamento.supervisorNome}
                                pessoas={pessoas} onChange={(supervisorMatricula) => alterarProgramacao(equipamento.tag, { supervisorMatricula })}
                                disabled={!podeGerenciar || !!manutencao || !equipamento.obraId || travado} />
                            </div>

                            {manutencao && (
                              <div className="col-span-full lg:order-6 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
                                <span className="font-semibold">Saída: {dataCurta(manutencao.dataSaida)} · Previsão de retorno: {dataCurta(manutencao.previsaoRetorno)}</span>
                                <span className="mx-1.5 opacity-50">|</span>
                                <span className="whitespace-pre-wrap break-words">{manutencao.descricao}</span>
                                <span className="block mt-0.5 opacity-80">Programação bloqueada até registrar o retorno pelo status.</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
        </div>
      </div>

      <p className="text-xs text-omega-500">
        Cada equipamento pode estar em uma obra por dia, com operador e supervisor. As escolhas só são gravadas no banco ao clicar em “Salvar programação”.
        Escolha “Sem programação” para liberar o dia. Clique no status do equipamento para registrar manutenção ou retorno.
        Cada obra mantém a mesma cor em todos os blocos. O PDF inclui a programação salva da frota mobilizada e dos terceiros, agrupada por categoria.
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
