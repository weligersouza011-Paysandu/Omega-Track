import { useEffect, useState } from 'react';
import { Fuel, Loader2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { COMBUSTIVEIS } from './VehicleTechnicalEditModal.jsx';
import { authHeaders, lerSessao } from '../utils/sessao.js';

function dataBR(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/**
 * Ficha essencial do veiculo para o setor Meio Ambiente: informacoes da
 * mobilizacao (somente leitura) e correcao do combustivel — unico campo que
 * este setor altera (o Transporte as vezes cadastra errado).
 */
export default function CombustivelVeiculoModal({ open, veiculo, onClose, onSaved }) {
  const [combustivel, setCombustivel] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!open || !veiculo) return;
    setCombustivel(veiculo.combustivel || '');
    setErro(null);
  }, [open, veiculo]);

  if (!veiculo) return null;

  const salvar = async () => {
    if (!COMBUSTIVEIS.includes(combustivel)) {
      setErro('Selecione um combustível válido.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const resp = await fetch(`/api/mob-desmob/${encodeURIComponent(veiculo.tag)}`, {
        method: 'PATCH',
        headers: authHeaders(lerSessao()),
        body: JSON.stringify({ combustivel }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.message || `Falha ao salvar o combustível (API ${resp.status}).`);
      onSaved?.({ ...veiculo, combustivel });
      onClose?.();
    } catch (falha) {
      setErro(falha.message || 'Falha ao salvar o combustível.');
    } finally {
      setSalvando(false);
    }
  };

  const Dado = ({ rotulo, valor }) => (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-omega-500">{rotulo}</div>
      <div className="text-sm font-semibold text-omega-900">{valor || '—'}</div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Veículo ${veiculo.tag}`}
      subtitle={`${veiculo.placa} • ${veiculo.status}`}
      footer={(
        <>
          <button onClick={onClose} disabled={salvando} className="btn-secondary">Fechar</button>
          <button onClick={salvar} disabled={salvando || combustivel === (veiculo.combustivel || '')} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
            {salvando && <Loader2 size={14} className="animate-spin" />}
            Salvar combustível
          </button>
        </>
      )}
    >
      {erro && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200/60 text-sm text-red-800">{erro}</div>}
      <div className="grid grid-cols-2 gap-4">
        <Dado rotulo="TAG" valor={veiculo.tag} />
        <Dado rotulo="Placa" valor={veiculo.placa} />
        <Dado rotulo="Modelo / Categoria" valor={veiculo.modelo} />
        <Dado rotulo="Contrato" valor={veiculo.contrato} />
        <Dado rotulo="Data MOB" valor={dataBR(veiculo.data_mob)} />
        <Dado rotulo="Data DESMOB" valor={dataBR(veiculo.data_desmob)} />
      </div>
      <div className="mt-5">
        <label className="label" htmlFor="ambiental-combustivel">
          <span className="inline-flex items-center gap-1"><Fuel size={12} /> Combustível</span>
        </label>
        <select id="ambiental-combustivel" value={combustivel} onChange={(e) => setCombustivel(e.target.value)} className="input">
          <option value="">Selecione...</option>
          {COMBUSTIVEIS.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
        </select>
        <p className="mt-1.5 text-xs text-omega-500">
          O Meio Ambiente revisa a lista de mobilização e corrige o combustível; os demais dados do veículo são do Transporte.
        </p>
      </div>
    </Modal>
  );
}
