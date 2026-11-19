import { useEffect, useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { authHeaders, lerSessao } from '../utils/sessao.js';
import { soDigitosContrato, contratoValido, MENSAGEM_CONTRATO } from '../utils/contrato.js';

const hojeISO = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

/**
 * Troca de contrato COM DATA: pergunta o contrato novo e o dia da troca. Da data em
 * diante os registros passam ao contrato novo; os anteriores permanecem no antigo.
 * `historicoEndpoint` (veiculo) lista as vigencias anteriores.
 */
export default function TransferirContratoModal({
  open, onClose, titulo, descricao, contratoAtual, endpoint, historicoEndpoint, aoConcluir,
}) {
  const [contrato, setContrato] = useState('');
  const [data, setData] = useState(hojeISO());
  const [contratos, setContratos] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const [limpeza, setLimpeza] = useState(null); // { mensagem } quando ha programacao a remover
  const [confirmouLimpeza, setConfirmouLimpeza] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    setContrato('');
    setData(hojeISO());
    setErro(null);
    setLimpeza(null);
    setConfirmouLimpeza(false);
    let vivo = true;
    (async () => {
      try {
        const [rc, rh] = await Promise.all([
          fetch('/api/contratos'),
          historicoEndpoint ? fetch(historicoEndpoint) : Promise.resolve(null),
        ]);
        if (vivo && rc.ok) setContratos((await rc.json()).data || []);
        if (vivo && rh?.ok) setHistorico((await rh.json()).data?.historico || []);
      } catch {
        /* a lista de contratos e uma sugestao; o campo aceita digitar */
      }
    })();
    return () => { vivo = false; };
  }, [open, historicoEndpoint]);

  const salvar = async () => {
    if (!contratoValido(contrato)) { setErro(MENSAGEM_CONTRATO); return; }
    if (contrato === contratoAtual) { setErro(`Já está no contrato ${contrato}.`); return; }
    if (!data || data > hojeISO()) { setErro('Informe o dia da troca (não pode ser futuro).'); return; }
    setSalvando(true);
    setErro(null);
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(lerSessao()),
        body: JSON.stringify({ contrato, data_efetiva: data, confirmar_limpeza_programacao: confirmouLimpeza }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (resp.status === 409 && corpo.codigo === 'PROGRAMACAO_FUTURA') {
        setLimpeza({ mensagem: corpo.message });
        return;
      }
      if (!resp.ok) throw new Error(corpo.message || `Falha ao trocar o contrato (API ${resp.status}).`);
      aoConcluir?.(corpo.data);
      onClose?.();
    } catch (falha) {
      setErro(falha.message || 'Falha ao trocar o contrato.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={salvando ? undefined : onClose}
      title={titulo}
      subtitle={`Contrato atual: ${contratoAtual}`}
      footer={(
        <>
          <button onClick={onClose} disabled={salvando} className="btn-secondary">Cancelar</button>
          <button
            onClick={salvar}
            disabled={salvando || (limpeza && !confirmouLimpeza)}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {salvando ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
            Transferir contrato
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {erro && <div className="rounded-xl border border-red-200/60 bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
        {descricao && <p className="text-sm text-omega-600">{descricao}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="transf-contrato">Novo contrato <span className="text-status-vermelho">*</span></label>
            <input
              id="transf-contrato"
              value={contrato}
              onChange={(e) => setContrato(soDigitosContrato(e.target.value))}
              list="transf-contratos"
              inputMode="numeric"
              maxLength={3}
              placeholder="Ex: 010"
              autoComplete="off"
              className="input font-mono"
            />
            <datalist id="transf-contratos">
              {contratos.filter((c) => c !== contratoAtual).map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="transf-data">Dia da troca <span className="text-status-vermelho">*</span></label>
            <input id="transf-data" type="date" value={data} max={hojeISO()} onChange={(e) => setData(e.target.value)} className="input" />
          </div>
        </div>
        <p className="text-xs text-omega-500">
          Do dia da troca em diante, os registros passam ao contrato novo. Tudo o que veio antes permanece no contrato {contratoAtual}.
        </p>
        {limpeza && (
          <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <input type="checkbox" checked={confirmouLimpeza} onChange={(e) => setConfirmouLimpeza(e.target.checked)} className="mt-0.5 h-4 w-4 accent-omega-900" />
            <span>{limpeza.mensagem}</span>
          </label>
        )}
        {historico.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-omega-500">Histórico de contratos</div>
            <ul className="divide-y divide-omega-100 rounded-xl border border-omega-100 text-sm">
              {historico.map((h) => (
                <li key={`${h.contrato}-${h.vigente_desde}`} className="flex items-center justify-between px-3 py-1.5">
                  <span className="font-mono font-bold text-omega-800">{h.contrato}</span>
                  <span className="text-xs text-omega-600">{dataBR(h.vigente_desde)} → {h.vigente_ate ? dataBR(h.vigente_ate) : 'atual'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
