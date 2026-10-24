import { useEffect, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import Modal from './Modal.jsx';
import CampoListaComCriador from './CampoListaComCriador.jsx';
import { authHeaders } from '../utils/sessao.js';
import { paraInputData } from '../utils/datas.js';

export default function EditVehicleModal({ open, veiculo, contratos = [], modelos = [], sessao, onClose, onSaved }) {
  const [form, setForm] = useState({ placa: '', modelo: '', contrato: '', status: 'Mobilizado', data_mob: '', data_desmob: '', km_limite_preventiva: '', km_ultima_preventiva: '' });
  const [arquivo, setArquivo] = useState(null);
  const [previewNova, setPreviewNova] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (open && veiculo) {
      setForm({
        placa: veiculo.placa || '',
        modelo: veiculo.modelo || veiculo.categoria || '',
        contrato: (veiculo.contrato || '').trim(),
        status: veiculo.status || 'Mobilizado',
        data_mob: paraInputData(veiculo.data_mob),
        data_desmob: veiculo.data_desmob ? paraInputData(veiculo.data_desmob) : '',
        km_limite_preventiva: veiculo.km_limite_preventiva ?? 10000,
        km_ultima_preventiva: veiculo.km_ultima_preventiva ?? '',
      });
      setArquivo(null);
      setPreviewNova(null);
      setErro(null);
    }
  }, [open, veiculo]);

  useEffect(() => {
    if (!arquivo) {
      setPreviewNova(null);
      return;
    }
    const url = URL.createObjectURL(arquivo);
    setPreviewNova(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  if (!open || !veiculo) return null;

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const salvar = async () => {
    const faltando = [];
    if (!form.placa.trim()) faltando.push('Placa');
    if (!String(form.modelo || '').trim()) faltando.push('Modelo / Categoria');
    if (!String(form.contrato || '').trim()) faltando.push('Contrato');
    if (!form.status) faltando.push('Status');
    if (!form.data_mob) faltando.push('Data MOB');
    if (form.status === 'Desmobilizado' && !form.data_desmob) faltando.push('Data DESMOB');

    if (faltando.length > 0) {
      setErro(`Preencha os campos obrigatórios: ${faltando.join(', ')}.`);
      return;
    }
    if (
      form.status === 'Desmobilizado' &&
      form.data_mob &&
      form.data_desmob < form.data_mob
    ) {
      setErro('A Data DESMOB não pode ser anterior à Data MOB.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      // Transicao para Desmobilizado passa pela purga oficial (apaga docs/anexos).
      const indoParaDesmob = form.status === 'Desmobilizado' && veiculo.status !== 'Desmobilizado';
      if (indoParaDesmob) {
        const ok = window.confirm(
          `Desmobilizar ${veiculo.tag}? Toda a documentação e anexos vinculados serão apagados do controle de vencimentos. O registro da desmobilização será mantido no histórico.`
        );
        if (!ok) {
          setSalvando(false);
          return;
        }
        const respDesmob = await fetch(`/api/mob-desmob/${encodeURIComponent(veiculo.tag)}/desmobilizar`, {
          method: 'PUT',
          headers: authHeaders(sessao),
          body: JSON.stringify({ data_desmob: form.data_desmob || null, observacao: null }),
        });
        if (!respDesmob.ok) {
          const corpo = await respDesmob.json().catch(() => ({}));
          throw new Error(corpo.message || `API respondeu ${respDesmob.status}`);
        }
        const { data } = await respDesmob.json();
        onSaved?.(data.veiculo);
        return;
      }
      // 1) Atualiza dados textuais (PUT /api/mob-desmob/:tag).
      const payload = {
        placa: form.placa.toUpperCase().trim(),
        modelo: form.modelo.trim() || null,
        contrato: form.contrato.trim() || null,
        status: form.status,
        data_mob: form.data_mob,
        data_desmob: form.status === 'Desmobilizado' ? form.data_desmob : null,
        km_limite_preventiva: String(form.km_limite_preventiva ?? '').trim() === '' ? 10000 : Number(form.km_limite_preventiva),
        km_ultima_preventiva: String(form.km_ultima_preventiva ?? '').trim() === '' ? null : Number(form.km_ultima_preventiva),
      };
      const resp = await fetch(`/api/mob-desmob/${encodeURIComponent(veiculo.tag)}`, {
        method: 'PUT',
        headers: authHeaders(sessao),
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.message || `API respondeu ${resp.status}`);
      }
      let atualizado = (await resp.json()).data;

      // 2) Se há nova foto, sobe para o Cloudinary (POST /:tag/foto, campo `arquivo`).
      if (arquivo) {
        const fd = new FormData();
        fd.append('arquivo', arquivo);
        const headersFoto = authHeaders(sessao);
        delete headersFoto['Content-Type'];
        const respFoto = await fetch(`/api/mob-desmob/${encodeURIComponent(veiculo.tag)}/foto`, {
          method: 'POST',
          headers: headersFoto,
          body: fd,
        });
        if (!respFoto.ok) {
          const corpo = await respFoto.json().catch(() => ({}));
          throw new Error(corpo.message || `Falha no upload da foto (${respFoto.status})`);
        }
        const { data } = await respFoto.json();
        atualizado = { ...atualizado, foto_veiculo: data.foto_veiculo };
      }

      onSaved?.(atualizado);
    } catch (e) {
      setErro(e.message || 'Falha ao salvar. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const fotoAtual = previewNova || veiculo.foto_veiculo;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Editar veículo ${veiculo.tag}`}
      subtitle={`${veiculo.placa} • ${veiculo.status}`}
      footer={
        <>
          <button onClick={onClose} disabled={salvando} className="btn-secondary">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando} className="btn-primary inline-flex items-center gap-2">
            {salvando && <Loader2 size={15} className="animate-spin" />}
            {salvando ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {erro && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200/60 text-sm text-red-800">
            {erro}
          </div>
        )}

        <div>
          <div className="label">Foto do Veículo</div>
          <div className="flex items-start gap-3">
            <div className="w-32 h-24 rounded-xl overflow-hidden bg-omega-100 border border-omega-100 shrink-0">
              {fotoAtual ? (
                <img src={fotoAtual} alt={`Foto ${veiculo.tag}`} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-omega-400 text-[11px]">
                  Sem foto
                </div>
              )}
            </div>
            <label className="flex-1 cursor-pointer rounded-xl border border-dashed border-omega-200 hover:border-omega-400 bg-omega-50/50 px-3 py-3 flex items-center gap-2 text-xs text-omega-600 transition-colors">
              <ImagePlus size={16} className="text-omega-500 shrink-0" />
              <span className="min-w-0">
                <span className="font-bold text-omega-800 block">
                  {arquivo ? arquivo.name : 'Alterar foto...'}
                </span>
                <span className="text-omega-500">JPEG, PNG ou WEBP — máx. 5 MB. Sobe para o Cloudinary.</span>
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={(e) => setArquivo(e.target.files?.[0] || null)}
              />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">TAG (identificador)</label>
            <input value={veiculo.tag} disabled className="input font-mono bg-omega-50 text-omega-500" />
          </div>
          <div>
            <label className="label" htmlFor="edit-placa">Placa <span className="text-status-vermelho">*</span></label>
            <input
              id="edit-placa"
              value={form.placa}
              onChange={set('placa')}
              className="input font-mono uppercase"
              placeholder="SZI0E93"
              required
            />
          </div>
          <div className="md:col-span-2">
            <CampoListaComCriador
              id="edit-modelo"
              label="Modelo / Categoria"
              required
              value={form.modelo}
              onChange={set('modelo')}
              opcoes={modelos}
              placeholderSelecionar="Selecione o modelo..."
              placeholderNovo="Digite o novo modelo (ex: Caminhão Munck)..."
            />
          </div>
          <div>
            <CampoListaComCriador
              id="edit-contrato"
              label="Contrato"
              required
              value={form.contrato}
              onChange={set('contrato')}
              opcoes={contratos.map((c) => c.nome).filter((nome) => nome !== 'Sem contrato')}
              placeholderSelecionar="Selecione o contrato..."
              placeholderNovo="Digite o novo contrato..."
            />
          </div>
          <div>
            <label className="label" htmlFor="edit-status">Status <span className="text-status-vermelho">*</span></label>
            <select
              id="edit-status"
              value={form.status}
              onChange={set('status')}
              className="input"
              required
            >
              <option value="">Selecione o status...</option>
              <option>Mobilizado</option>
              <option>Desmobilizado</option>
            </select>
            {form.status === 'Desmobilizado' && veiculo.status !== 'Desmobilizado' && (
              <div className="mt-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200/60 rounded-lg px-2 py-1.5">
                Ao salvar, a documentação e os anexos serão apagados do controle de vencimentos.
              </div>
            )}
          </div>
          <div>
            <label className="label" htmlFor="edit-data-mob">Data MOB <span className="text-status-vermelho">*</span></label>
            <input
              id="edit-data-mob"
              type="date"
              value={form.data_mob}
              onChange={set('data_mob')}
              className="input"
              required
            />
          </div>
          {form.status === 'Desmobilizado' && (
            <div>
              <label className="label" htmlFor="edit-data-desmob">
                Data DESMOB <span className="text-status-vermelho">*</span>
              </label>
              <input
                id="edit-data-desmob"
                type="date"
                value={form.data_desmob}
                min={form.data_mob || undefined}
                onChange={set('data_desmob')}
                className="input"
                required
              />
            </div>
          )}
          <div>
            <label className="label">Limite preventiva (km)</label>
            <input type="number" min="1" value={form.km_limite_preventiva} onChange={set('km_limite_preventiva')} className="input tabular-nums" placeholder="10000" />
          </div>
          <div>
            <label className="label">Última preventiva (km)</label>
            <input type="number" min="0" value={form.km_ultima_preventiva} onChange={set('km_ultima_preventiva')} className="input tabular-nums" placeholder="Sem registro" />
          </div>
        </div>
      </div>
    </Modal>
  );
}
