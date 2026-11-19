import { useEffect, useId, useMemo, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import AvisoContratoLancamento from './AvisoContratoLancamento.jsx';
import Modal from './Modal.jsx';
import { authHeaders } from '../utils/sessao.js';
import { mensagemFalha } from '../offline/index.js';

// Mais usadas na operação; a digitação livre continua permitida.
const FUNCOES_SUGERIDAS = ['Motorista', 'Operador', 'Supervisor', 'Ajudante', 'Operador de Munck', 'Encarregado'];

// "Novo Usuário Operacional": mesmo cadastro da Gestão de Usuários (matrícula,
// nome e função; sem senha nem permissões administrativas), feito por cima da
// Programação sem perder as alocações não salvas.
export default function NovoColaboradorModal({
  aberto, funcaoInicial = '', nomeInicial = '', matriculaInicial = '', destino,
  funcoesExistentes = [], sessao, onFechar, onCriado,
}) {
  const [matricula, setMatricula] = useState('');
  const [nome, setNome] = useState('');
  const [funcao, setFuncao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const listaId = useId();

  const sugestoes = useMemo(() => [...new Set([...FUNCOES_SUGERIDAS, ...funcoesExistentes]
    .map((f) => String(f || '').trim()).filter(Boolean))], [funcoesExistentes]);

  useEffect(() => {
    if (!aberto) return;
    setMatricula(matriculaInicial || '');
    setNome(nomeInicial || '');
    setFuncao(funcaoInicial || '');
    setErro('');
  }, [aberto, funcaoInicial, nomeInicial, matriculaInicial]);

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
        body: JSON.stringify({
          matricula: matricula.trim() || null,
          nome: nome.trim(),
          funcao: funcao.trim() || null,
        }),
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
      title="Novo Usuário Operacional"
      subtitle={<>{destino ? `Será selecionado automaticamente em ${destino} ao salvar` : 'Cadastro rápido'} <br /><AvisoContratoLancamento rotulo="O usuário será cadastrado no contrato" /></>}
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
          <label className="label" htmlFor="novo-colab-matricula">Matrícula</label>
          <input id="novo-colab-matricula" className="input font-mono" value={matricula} maxLength={50}
            autoFocus={!matriculaInicial && !nomeInicial}
            onChange={(e) => setMatricula(e.target.value.replace(/\s/g, ''))}
            placeholder="Ex.: 12345" />
          <p className="mt-1 text-[11px] text-omega-500">
            Em branco, o sistema gera uma matrícula provisória (PROV-…), que pode ser corrigida depois em Gestão de Usuários.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="novo-colab-nome">Nome completo <span className="text-status-vermelho">*</span></label>
          <input id="novo-colab-nome" className="input" value={nome} maxLength={255} required
            autoFocus={Boolean(matriculaInicial || nomeInicial)}
            onChange={(e) => setNome(e.target.value)} placeholder="Ex.: João da Silva" />
        </div>
        <div>
          <label className="label" htmlFor="novo-colab-funcao">Função</label>
          <input id="novo-colab-funcao" className="input" value={funcao} maxLength={100} list={listaId}
            onChange={(e) => setFuncao(e.target.value)} placeholder="Ex.: Motorista" autoComplete="off" />
          <datalist id={listaId}>
            {sugestoes.map((f) => <option key={f} value={f} />)}
          </datalist>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {FUNCOES_SUGERIDAS.map((f) => (
              <button key={f} type="button" onClick={() => setFuncao(f)} aria-pressed={funcao === f}
                className="prog-chip-filtro rounded-full border border-omega-200 px-2 py-0.5 text-[11px] font-semibold text-omega-600 hover:bg-omega-50 transition-colors">
                {f}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-omega-500">
          Usuário Operacional: sem senha e sem acesso administrativo. Fica disponível como operador, motorista e supervisor na Programação.
        </p>
      </form>
    </Modal>
  );
}
