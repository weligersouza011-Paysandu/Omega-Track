import { useEffect, useState } from 'react';
import { Briefcase } from 'lucide-react';
import { lerSessao, salvarSessao } from '../utils/sessao.js';
import { lerContratoSelecionado, salvarContratoSelecionado, CONTRATO_TODOS } from '../utils/contrato.js';

/**
 * Filtro global de contrato. Todo usuario pertence a UM contrato, que ja vem
 * pre-definido: quem nao e Master so ve o rotulo; o Master troca entre os
 * contratos ou escolhe "Todos os contratos". A escolha vale para todas as
 * telas (o fetch anexa `?contrato=`), por isso a pagina recarrega ao trocar.
 */
export default function SeletorContrato({ usuario }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const resp = await fetch('/api/contratos');
        if (!resp.ok) return;
        const corpo = await resp.json();
        if (!vivo || !corpo?.meu) return;
        // A sessao guardada pode ter o contrato antigo (anterior a padronizacao): sincroniza uma vez.
        if (corpo.meu !== usuario?.contrato) {
          const atual = lerSessao();
          if (atual?.token) {
            salvarSessao(atual.token, { ...atual.usuario, contrato: corpo.meu });
            window.location.reload();
            return;
          }
        }
        // Selecao guardada que nao existe mais (ex.: contrato sem dados) volta ao padrao.
        const guardada = lerContratoSelecionado();
        if (guardada && guardada !== CONTRATO_TODOS && !corpo.data.includes(guardada)) salvarContratoSelecionado('');
        setInfo(corpo);
      } catch {
        /* o filtro e auxiliar: sem rede, a tela segue sem ele */
      }
    })();
    return () => { vivo = false; };
  }, [usuario?.contrato]);

  if (!info) return null;

  if (!info.master) {
    return (
      <span
        title="Você enxerga os dados do seu contrato"
        className="inline-flex items-center gap-1.5 rounded-lg border border-omega-200 bg-omega-50 px-2.5 py-1.5 text-xs font-bold text-omega-700"
      >
        <Briefcase size={13} className="text-omega-400" /> Contrato {info.meu}
      </span>
    );
  }

  const selecionado = lerContratoSelecionado() || info.meu;
  const trocar = (e) => {
    const valor = e.target.value;
    salvarContratoSelecionado(valor === info.meu ? '' : valor);
    window.location.reload();
  };

  return (
    <label
      title={selecionado === CONTRATO_TODOS
        ? 'Visão de todos os contratos. Para lançar ou importar dados, escolha um contrato.'
        : 'Contrato exibido nas telas'}
      className={'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-bold ' +
        (selecionado === CONTRATO_TODOS
          ? 'border-amber-300 bg-amber-50 text-amber-800'
          : 'border-omega-200 bg-omega-50 text-omega-700')}
    >
      <Briefcase size={13} className="shrink-0" />
      <select
        value={selecionado}
        onChange={trocar}
        aria-label="Contrato exibido"
        className="bg-transparent text-xs font-bold outline-none cursor-pointer"
      >
        {info.data.map((c) => <option key={c} value={c}>Contrato {c}</option>)}
        <option value={CONTRATO_TODOS}>Todos os contratos</option>
      </select>
    </label>
  );
}
