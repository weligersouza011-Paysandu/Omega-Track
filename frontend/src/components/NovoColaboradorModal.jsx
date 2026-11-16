import { useEffect, useState } from 'react';
import { HardHat, Loader2, UserPlus, Wrench } from 'lucide-react';
import Modal from './Modal.jsx';
import { authHeaders } from '../utils/sessao.js';
import { mensagemFalha } from '../offline/index.js';

const FUNCOES = [
  { valor: 'OPERADOR', rotulo: 'Operador / Motorista', Icone: Wrench },
  { valor: 'SUPERVISOR', rotulo: 'Supervisor', Icone: HardHat },
];

// Cadastro rápido de Operador/Supervisor sem sair da Programação: as
// alocações não salvas da tela continuam intactas (é só um modal por cima).
export default function NovoColaboradorModal({
  aberto, funcaoInicial = 'OPERADOR', nomeInicial = '', destino, sessao, onFechar, onCriado,
}) {
  const [nome, setNome] = useState('');
  const [matricula, setMatricula] = useState('');
  const [funcao, setFuncao] = useState(funcaoInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!aberto) return;
    setNome(nomeInicial || '');
    setMatricula('');
    setFuncao(funcaoInicial || 'OPERADOR');
    setErro('');
  }, [aberto, funcaoInicial, nomeInicial]);

  const fechar = () => { if (!salvando) onFechar(); };

  async function salvar(evento) {
    evento?.preventDefault();
    if (salvando) return;
    if (!nome.trim()) {
      setErro('Informe o nome completo.');
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      const resposta = await fetch('/api/usuarios/rapido', {
        method: 'POST',
        headers: authHeaders(sessao),
        body: JSON.stringify({ nome: nome.trim(), matricula: matricula.trim() || null, funcao }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.message || `Erro ao cadastrar (${resposta.status})`);
      onCriado(corpo.data);
    } catch (falha) {
      setErro(mensagemFalha(falha, 'Não foi possível cadastrar.'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal open={aberto} onClose={fechar} size="sm"
      title="Novo Operador / Supervisor"
      subtitle={destino ? `Será selecionado em ${destino} ao salvar` : 'Cadastro rápido'}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={fechar} disabled={salvando}>Cancelar</button>
          <button type="submit" form="form-novo-colaborador" className="btn-primary" disabled={salvando}>
            {salvando ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
            {salvando ? 'Cadastrando...' : 'Cadastrar e selecionar'}
          </button>
        </>
      }>
      <form id="form-novo-colaborador" onSubmit={salvar} className="space-y-4">
        {erro && (
          <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200/60 text-sm text-red-800">{erro}</div>
        )}
        <div>
          <label className="label" htmlFor="novo-colab-nome">Nome completo <span className="text-status-vermelho">*</span></label>
          <input id="novo-colab-nome" className="input" value={nome} maxLength={255} autoFocus required
            onChange={(e) => setNome(e.target.value)} placeholder="Ex.: João da Silva" />
        </div>
        <div>
          <label className="label" htmlFor="novo-colab-matricula">Matrícula</label>
          <input id="novo-colab-matricula" className="input font-mono" value={matricula} maxLength={50}
            onChange={(e) => setMatricula(e.target.value.replace(/\s/g, ''))}
            placeholder="Deixe em branco para gerar automaticamente" />
          <p className="mt-1 text-[11px] text-omega-500">Sem matrícula, o sistema gera uma provisória (PROV-…), que pode ser corrigida depois em Usuários.</p>
        </div>
        <fieldset>
          <legend className="label">Tipo / Função</legend>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-omega-100 p-1" role="radiogroup">
            {FUNCOES.map(({ valor, rotulo, Icone }) => (
              <button key={valor} type="button" role="radio" aria-checked={funcao === valor}
                onClick={() => setFuncao(valor)}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${funcao === valor
                  ? 'bg-white text-omega-900 shadow-sm' : 'text-omega-600 hover:text-omega-900'}`}>
                <Icone size={15} /> {rotulo}
              </button>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
