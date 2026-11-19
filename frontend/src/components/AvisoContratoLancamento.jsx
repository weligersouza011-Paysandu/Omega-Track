import { Briefcase } from 'lucide-react';
import { lerSessao } from '../utils/sessao.js';
import { contratoDeLancamento } from '../utils/contrato.js';

/**
 * "Os dados serão lançados no contrato X": nas importações o contrato é o de
 * quem importa, sem escolher item a item. Master em "Todos os contratos"
 * precisa escolher um contrato no filtro do topo antes de importar.
 */
export default function AvisoContratoLancamento({ usuario, rotulo = 'Os dados serão lançados no contrato' }) {
  const alvo = usuario || lerSessao()?.usuario;
  const contrato = contratoDeLancamento(alvo);
  if (contrato) {
    return (
      <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-omega-100 px-2 py-0.5 text-[11px] font-bold text-omega-700">
        <Briefcase size={11} /> {rotulo} {contrato}
      </span>
    );
  }
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
      <Briefcase size={11} /> Escolha um contrato no filtro do topo para lançar dados (hoje: todos os contratos)
    </span>
  );
}
