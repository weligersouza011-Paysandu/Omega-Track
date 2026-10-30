import { authHeaders } from './sessao.js';
import { podeVerTodasPartes } from './permissoes.js';
import { extrairPartesData } from './datas.js';

const normalizar = (valor) => String(valor || '').trim().toUpperCase();

export function pertenceAoUsuario(parte, usuario) {
  if (!usuario) return false;
  const matricula = normalizar(usuario.matricula);
  const nome = normalizar(usuario.nome);
  const operador = normalizar(parte?.operador);
  const funcionario = normalizar(parte?.funcionario);
  return !!((matricula && (operador === matricula || funcionario.includes(matricula)))
    || (nome && funcionario && (funcionario === nome || funcionario.includes(nome) || nome.includes(funcionario))));
}

export function filtrarPartesDiarias(partes, usuario, filtros = {}) {
  const { busca = '', status = 'todos', assinatura = 'todos', data = '' } = filtros;
  const visaoTotal = podeVerTodasPartes(usuario);
  const termo = normalizar(busca);
  return partes.filter((parte) => {
    if (!visaoTotal && !pertenceAoUsuario(parte, usuario)) return false;
    if (status !== 'todos' && (parte.status_aprovacao || parte.status) !== status) return false;
    if (assinatura !== 'todos' && parte.status_assinatura !== assinatura) return false;
    const dia = extrairPartesData(parte.data);
    if (data && (!dia || `${dia.ano}-${dia.mes}-${dia.dia}` !== data)) return false;
    if (!termo) return true;
    return [parte.tag, parte.veiculo?.placa || parte.placa, parte.funcionario,
      parte.operador, parte.obra, parte.lideranca, parte.id_relatorio]
      .some((valor) => normalizar(valor).includes(termo));
  });
}

// Busca todas as páginas do dia, sem limitar o Excel aos registros já carregados na tela.
export async function carregarPartesDoDia(sessao, filtros) {
  const { data } = filtros;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) throw new Error('Selecione um dia para exportar.');
  const partes = new Map();
  let pagina = 1;
  let paginas = 1;
  do {
    const params = new URLSearchParams({
      data_inicio: data, data_fim: data, limit: '100', page: String(pagina),
    });
    if (!podeVerTodasPartes(sessao?.usuario) && sessao?.usuario?.matricula) {
      params.set('operador', String(sessao.usuario.matricula));
    }
    const resposta = await fetch(`/api/partes-diarias?${params}`, {
      headers: authHeaders(sessao), cache: 'no-store',
    });
    if (!resposta.ok) throw new Error(`Não foi possível consultar as Partes Diárias (${resposta.status}).`);
    const corpo = await resposta.json();
    if (!Array.isArray(corpo.data)) throw new Error('A consulta retornou dados inválidos.');
    corpo.data.forEach((parte, indice) => partes.set(parte.id || `${pagina}-${indice}`, parte));
    paginas = Number(corpo.pagination?.pages) || 1;
    pagina += 1;
  } while (pagina <= paginas);
  return filtrarPartesDiarias([...partes.values()], sessao?.usuario, filtros);
}
