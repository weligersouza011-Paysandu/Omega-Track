// Alerta de placas da telemetria sem vínculo com a frota (nem mobilizadas, nem desmobilizadas),
// com exclusão rápida de todos os registros de cada placa. Desmobilizados não entram no alerta.
// Dados: GET /api/telemetria/placas-nao-cadastradas e DELETE /api/telemetria/por-placa/:placa.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Trash2 } from 'lucide-react';
import { apiTelemetria, formatarDataHora } from '../../utils/telemetriaApi.js';
import {
  podeExcluirPorPlaca, rotuloPlacaSemCadastro, textoAlertaPlacas, textoConfirmacaoExclusao,
} from '../../utils/trajetoTelemetria.js';

export default function AlertaPlacasNaoCadastradas({ usuario, versao = 0, onExcluido }) {
  const [placas, setPlacas] = useState([]);
  const [aberto, setAberto] = useState(true);
  const [excluindo, setExcluindo] = useState(null);
  const podeExcluir = podeExcluirPorPlaca(usuario);

  const carregar = useCallback(async () => {
    try {
      const dados = await apiTelemetria('/placas-nao-cadastradas', { erro: 'Erro ao verificar placas sem cadastro' });
      setPlacas(dados.placas || []);
    } catch {
      // Alerta complementar: se a verificação falhar, a tela segue sem ele.
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar, versao]);

  async function excluir(p) {
    if (!window.confirm(`${textoConfirmacaoExclusao(p)} Esta ação não pode ser desfeita.`)) return;
    setExcluindo(p.placa);
    try {
      await apiTelemetria(`/por-placa/${encodeURIComponent(p.placa)}`, { metodo: 'DELETE', erro: 'Falha ao excluir os registros da placa' });
      // Retira na hora; a recarga confirma com o servidor.
      setPlacas((lista) => lista.filter((x) => x.placa !== p.placa));
      onExcluido?.(p);
      carregar();
    } catch (e) {
      alert(e.message);
    } finally {
      setExcluindo(null);
    }
  }

  // Sem placas (ou falha na verificação): nada a alertar.
  if (!placas.length) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4" role="alert">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-status-amarelo" />
          <div>
            <div className="font-bold">{textoAlertaPlacas(placas.length)}</div>
            <div className="text-xs text-amber-800">
              Cadastre o veículo em Mobilização ou exclua os registros. Veículos desmobilizados não aparecem aqui.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex items-center gap-1 self-start rounded-md px-2 py-1 text-xs font-bold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100 sm:self-auto"
          aria-expanded={aberto}
        >
          {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {aberto ? 'Ocultar placas' : 'Ver placas'}
        </button>
      </div>
      {aberto && (
        <ul className="mt-3 divide-y divide-amber-200 rounded-lg bg-white/70 ring-1 ring-amber-200">
          {placas.map((p) => (
            <li key={p.placa} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="font-bold text-omega-900">{rotuloPlacaSemCadastro(p)}</span>
                <span className="ml-2 text-xs text-omega-500">
                  {formatarDataHora(p.primeiroRegistro)} → {formatarDataHora(p.ultimoRegistro)}
                </span>
              </div>
              {podeExcluir && (
                <button
                  type="button"
                  onClick={() => excluir(p)}
                  disabled={excluindo !== null}
                  className="flex items-center gap-1 self-start rounded-md px-2 py-1 text-xs font-semibold text-status-vermelho ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50 sm:self-auto"
                >
                  {excluindo === p.placa ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Excluir registros
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
