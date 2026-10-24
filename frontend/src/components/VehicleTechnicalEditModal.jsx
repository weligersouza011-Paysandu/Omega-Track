import { useEffect, useState } from 'react';
import { X, Loader2, Pencil, Gauge, ShieldCheck, Fuel } from 'lucide-react';
import { authHeaders, lerSessao } from '../utils/sessao.js';

export const COMBUSTIVEIS = [
  'Diesel S10',
  'Gasolina Comum',
  'Gasolina Aditivada',
  'Etanol',
  'Flex',
  'Elétrico / Híbrido',
];

const FORM_VAZIO = {
  chassi: '',
  renavam: '',
  cor: '',
  ano_fabricacao: '',
  ano_modelo: '',
  km_inicial: '',
  combustivel: 'Diesel S10',
};

const inputCls =
  'w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500 transition-colors';
const labelCls = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400';

function textoNumero(valor) {
  return valor === null || valor === undefined ? '' : String(valor);
}

function inteiroOpcional(valor, rotulo, { min, max } = {}) {
  const texto = String(valor ?? '').trim();
  if (texto === '') return { valor: null, erro: null };
  const numero = Number(texto);
  if (!Number.isInteger(numero)) {
    return { valor: null, erro: `${rotulo} deve ser um número inteiro.` };
  }
  if (min !== undefined && numero < min) {
    return { valor: null, erro: `${rotulo} deve ser maior ou igual a ${min}.` };
  }
  if (max !== undefined && numero > max) {
    return { valor: null, erro: `${rotulo} deve ser menor ou igual a ${max}.` };
  }
  return { valor: numero, erro: null };
}

export default function VehicleTechnicalEditModal({ open, veiculo, onClose, onSaved }) {
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!open || !veiculo) return;
    setForm({
      chassi: veiculo.chassi || '',
      renavam: veiculo.renavam || '',
      cor: veiculo.cor || '',
      ano_fabricacao: textoNumero(veiculo.ano_fabricacao ?? veiculo.ano),
      ano_modelo: textoNumero(veiculo.ano_modelo ?? veiculo.ano),
      km_inicial: textoNumero(veiculo.km_inicial ?? veiculo.horimetro_inicial),
      combustivel: veiculo.combustivel || 'Diesel S10',
    });
    setErro(null);
    setSalvando(false);
  }, [open, veiculo]);

  if (!open || !veiculo) return null;

  const alterar = (campo) => (e) => setForm((atual) => ({ ...atual, [campo]: e.target.value }));

  const salvar = async (e) => {
    e?.preventDefault();
    if (salvando) return;

    const anoMaximo = new Date().getFullYear() + 1;
    const anoFabricacao = inteiroOpcional(form.ano_fabricacao, 'Ano Fabricação', {
      min: 1900,
      max: anoMaximo,
    });
    const anoModelo = inteiroOpcional(form.ano_modelo, 'Ano Modelo', {
      min: 1900,
      max: anoMaximo,
    });
    const kmInicial = inteiroOpcional(form.km_inicial, 'KM Inicial MOB', { min: 0 });

    const erroCampo = anoFabricacao.erro || anoModelo.erro || kmInicial.erro;
    if (erroCampo) {
      setErro(erroCampo);
      return;
    }
    if (
      anoFabricacao.valor !== null &&
      anoModelo.valor !== null &&
      anoModelo.valor < anoFabricacao.valor
    ) {
      setErro('Ano Modelo não pode ser anterior ao Ano Fabricação.');
      return;
    }
    if (!COMBUSTIVEIS.includes(form.combustivel)) {
      setErro('Selecione um combustível válido.');
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      const payload = {
        chassi: form.chassi.trim(),
        renavam: form.renavam.trim(),
        cor: form.cor.trim(),
        ano_fabricacao: anoFabricacao.valor,
        ano_modelo: anoModelo.valor,
        km_inicial: kmInicial.valor,
        combustivel: form.combustivel,
      };
      const resp = await fetch(`/api/mob-desmob/${encodeURIComponent(veiculo.tag)}`, {
        method: 'PATCH',
        headers: authHeaders(lerSessao()),
        body: JSON.stringify(payload),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(corpo.message || `Falha ao salvar dados técnicos (API ${resp.status}).`);
      }
      onSaved?.(corpo.data);
      onClose?.();
    } catch (err) {
      setErro(err.message || 'Falha ao salvar os dados técnicos. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-edicao-tecnica"
    >
      <div
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        onClick={() => { if (!salvando) onClose?.(); }}
      />
      <div className="relative w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center shrink-0">
              <Pencil size={17} />
            </div>
            <div className="min-w-0">
              <h2 id="titulo-edicao-tecnica" className="text-base font-black text-white">
                Editar Dados Técnicos
              </h2>
              <p className="text-xs text-slate-400 truncate">
                {veiculo.tag} • {veiculo.placa} — alterações gravadas em MobDesmob
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="p-2 -mr-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            title="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={salvar} className="flex flex-col min-h-0">
          <div className="px-5 py-4 space-y-5 overflow-y-auto">
            {erro && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm font-semibold text-rose-300">
                {erro}
              </div>
            )}

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-400">
                <ShieldCheck size={14} />
                <span>Identificação Veicular</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-3">
                  <label className={labelCls} htmlFor="tecnico-chassi">Número do Chassi</label>
                  <input
                    id="tecnico-chassi"
                    value={form.chassi}
                    onChange={alterar('chassi')}
                    className={`${inputCls} font-mono uppercase`}
                    placeholder="Ex: 9BWZZZ377VT004251"
                    maxLength={50}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="tecnico-renavam">Renavam</label>
                  <input
                    id="tecnico-renavam"
                    value={form.renavam}
                    onChange={alterar('renavam')}
                    className={`${inputCls} font-mono`}
                    placeholder="Ex: 01234567890"
                    maxLength={50}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="tecnico-cor">Cor</label>
                  <input
                    id="tecnico-cor"
                    value={form.cor}
                    onChange={alterar('cor')}
                    className={inputCls}
                    placeholder="Ex: Branco"
                    maxLength={50}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                <Gauge size={14} />
                <span>Fabricação &amp; Mecânica</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={labelCls} htmlFor="tecnico-ano-fabricacao">Ano Fabricação</label>
                  <input
                    id="tecnico-ano-fabricacao"
                    type="number"
                    min="1900"
                    max={new Date().getFullYear() + 1}
                    step="1"
                    value={form.ano_fabricacao}
                    onChange={alterar('ano_fabricacao')}
                    className={`${inputCls} tabular-nums`}
                    placeholder="2020"
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="tecnico-ano-modelo">Ano Modelo</label>
                  <input
                    id="tecnico-ano-modelo"
                    type="number"
                    min="1900"
                    max={new Date().getFullYear() + 1}
                    step="1"
                    value={form.ano_modelo}
                    onChange={alterar('ano_modelo')}
                    className={`${inputCls} tabular-nums`}
                    placeholder="2021"
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="tecnico-km-inicial">KM Inicial MOB</label>
                  <input
                    id="tecnico-km-inicial"
                    type="number"
                    min="0"
                    step="1"
                    value={form.km_inicial}
                    onChange={alterar('km_inicial')}
                    className={`${inputCls} tabular-nums`}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="tecnico-combustivel">
                    <span className="inline-flex items-center gap-1"><Fuel size={11} /> Combustível</span>
                  </label>
                  <select
                    id="tecnico-combustivel"
                    value={form.combustivel}
                    onChange={alterar('combustivel')}
                    className={inputCls}
                    required
                  >
                    <option value="">Selecione...</option>
                    {COMBUSTIVEIS.map((opcao) => (
                      <option key={opcao} value={opcao}>{opcao}</option>
                    ))}
                  </select>
                </div>
              </div>
            </section>
          </div>

          <div className="border-t border-slate-800 bg-slate-950/50 px-5 py-3.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={salvando}
              className="px-3.5 py-2 rounded-xl border border-slate-700 text-xs font-bold text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-black hover:bg-sky-400 transition-colors shadow-lg shadow-sky-500/20 disabled:opacity-50"
            >
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
              {salvando ? 'Salvando...' : 'Salvar Dados Técnicos'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
