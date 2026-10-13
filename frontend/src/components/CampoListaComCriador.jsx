import { useState } from 'react';
import { Plus, List } from 'lucide-react';

// Lista suspensa com criador: select dinâmico + botão "+" que alterna para input livre.
// Regra: se o usuário não clicar no "+", escolhe uma opção da lista; se clicar,
// digita o novo valor (que passa a ser enviado ao backend e entra na lista).
export default function CampoListaComCriador({
  label,
  required = false,
  value,
  onChange,
  opcoes = [],
  placeholderSelecionar = 'Selecione...',
  placeholderNovo = 'Digite o novo valor...',
  id,
}) {
  const [modoNovo, setModoNovo] = useState(false);

  const opcoesUnicas = [
    ...new Set((opcoes || []).map((o) => String(o || '').trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const valorTrim = String(value || '').trim();
  const valorForaDaLista = valorTrim !== '' && !opcoesUnicas.includes(valorTrim);

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label} {required && <span className="text-status-vermelho">*</span>}
      </label>
      <div className="flex gap-2">
        {modoNovo ? (
          <input
            id={id}
            value={value}
            onChange={onChange}
            className="input flex-1"
            placeholder={placeholderNovo}
          />
        ) : (
          <select id={id} value={valorForaDaLista ? valorTrim : value} onChange={onChange} className="input flex-1">
            <option value="">{placeholderSelecionar}</option>
            {valorForaDaLista && <option value={valorTrim}>{valorTrim}</option>}
            {opcoesUnicas.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => setModoNovo((m) => !m)}
          title={modoNovo ? 'Voltar à lista' : 'Adicionar novo'}
          className="shrink-0 w-10 rounded-lg border border-omega-200 bg-white hover:bg-omega-50 text-omega-700 flex items-center justify-center transition-colors"
        >
          {modoNovo ? <List size={16} /> : <Plus size={16} />}
        </button>
      </div>
    </div>
  );
}
