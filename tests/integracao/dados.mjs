// Dados de dois contratos para o teste de vazamento. Todo texto de cada contrato
// carrega um marcador unico (X251 / X999): se o marcador de um contrato aparecer
// numa resposta destinada ao outro, houve vazamento.
const HOJE = new Date();
const DIA = new Date(Date.UTC(HOJE.getUTCFullYear(), HOJE.getUTCMonth(), HOJE.getUTCDate()));
export const DIA_ISO = DIA.toISOString().slice(0, 10);
export const MES_ISO = DIA_ISO.slice(0, 7);

export const CONTRATOS = ['251', '999'];

export async function semearContrato(p, c) {
  const m = `X${c}`; // marcador
  const ids = {};
  const usuario = (dados) => p.usuario.create({ data: { contrato: c, funcao: `Func ${m}`, ...dados } });

  ids.normal = (await usuario({ nome: `Normal ${m}`, matricula: `N${m}`, tipo: 'ADMINISTRADOR', setor: 'TRANSPORTE', nivel: 'NORMAL' })).id;
  ids.gestao = (await usuario({ nome: `Gestao ${m}`, matricula: `G${m}`, tipo: 'ADMINISTRADOR', setor: 'GESTAO', nivel: 'NORMAL' })).id;
  ids.ambiente = (await usuario({ nome: `Ambiente ${m}`, matricula: `A${m}`, tipo: 'ADMINISTRADOR', setor: 'MEIO_AMBIENTE', nivel: 'NORMAL' })).id;
  ids.operador = (await usuario({ nome: `Operador ${m}`, matricula: `O${m}`, tipo: 'OPERACIONAL' })).id;

  const veiculo = (n) => p.mobDesmob.create({
    data: { tag: `${m}V${n}`, placa: `${m}P${n}`, modelo: `Van ${m}`, contrato: c, locacao: `Loc ${m}`, status: 'Mobilizado', data_mob: new Date('2026-01-01'), combustivel: 'Diesel S10' },
  });
  await veiculo(1);
  await veiculo(2);
  ids.tag = `${m}V1`;
  ids.placa = `${m}P1`;

  const obra = await p.obra.create({ data: { nome: `Obra ${m}`, contrato: c, numero_contrato: `NC${m}`, gestao: `Gestor ${m}`, planejador: `Planej ${m}` } });
  ids.obra = obra.id;
  await p.programacaoRecurso.create({ data: { tag: ids.tag, obra_id: obra.id, data: DIA, contrato: c, operador_nome: `Motorista ${m}`, operador_matricula: `O${m}`, supervisor_nome: `Supervisor ${m}` } });
  ids.terceiro = (await p.veiculoTerceiro.create({ data: { tag: `${m}T1`, tipo: `Tipo ${m}`, empresa_terceira: `Empresa ${m}`, contrato: c } })).id;

  ids.parte = (await p.parteDiaria.create({
    data: {
      tag: ids.tag, contrato: c, data: DIA, status: 'APROVADO', status_operacional: 'Operação', status_aprovacao: 'Aprovado',
      funcionario: `Func ${m}`, operador: `O${m}`, obra: `Obra ${m}`, obra_id: obra.id, numero_relatorio: `RDO-${m}`, observacao_rapida: `Obs ${m}`,
    },
  })).id;
  ids.doc = (await p.documentacaoVeiculo.create({ data: { tag: ids.tag, documento: `CRLV ${m}`, validade: new Date('2027-01-01') } })).id;
  ids.manutencao = (await p.manutencaoRecurso.create({
    data: { tag: ids.tag, tipo: 'PREVENTIVA', data_saida: DIA, previsao_retorno: DIA, descricao: `Oficina ${m}` },
  })).id;

  ids.evento = (await p.eventoTelemetria.create({
    data: {
      tag_placa: ids.placa, tag: ids.tag, motorista: `Mot ${m}`, data_hora: new Date(), evento: 'Excesso de Velocidade', valor: 95, limite: 80,
      severidade: 'MODERADO', localizacao: `Local ${m}`, chave_unica: `chave-${m}`, contrato: c,
    },
  })).id;
  ids.plano = (await p.planoAcaoTelemetria.create({
    data: { motorista: `Mot ${m}`, linha_matriz: 'FADIGA_VERDADEIRA', medida_matriz: `Medida ${m}`, contrato: c },
  })).id;

  ids.residuo = (await p.residuo.create({
    data: { data: DIA, tipo_residuos: `Residuo ${m}`, destinacao: 'CMD', quantidade_kg_l: 10, mes_ano: MES_ISO.replace('-', '/'), contrato: c },
  })).id;
  ids.agua = (await p.consumoAgua.create({ data: { data: DIA, pontos_captacao: `Ponto ${m}`, consumo_m3: 5, ano_mes: MES_ISO.replace('-', '/'), contrato: c } })).id;
  ids.ato = (await p.atoAutorizativo.create({ data: { descricao_do_tipo_de_servico: `Servico ${m}`, licenca: `Licenca ${m}`, validade: new Date('2027-01-01'), contrato: c } })).id;
  ids.quimico = (await p.produtoQuimico.create({ data: { nome_produto: `Produto ${m}`, contrato: c } })).id;
  ids.abastecimento = (await p.abastecimento.create({
    data: { placa: ids.placa, tag: ids.tag, tipo_combustivel: 'DIESEL', litros: 40, data_transacao: new Date(), mes_referencia: MES_ISO, contrato: c, nome_motorista: `Mot ${m}`, estabelecimento: `Posto ${m}` },
  })).id;
  ids.parametro = (await p.parametroPreventiva.create({ data: { categoria: `CAT ${m}`, km_limite_preventiva: 9000, contrato: c } })).id;
  await p.logAtividade.create({ data: { nome_usuario: `Log ${m}`, acao: 'TESTE', modulo: 'Teste', contrato: c } });
  return ids;
}

export async function semearTudo(p) {
  const todos = {};
  for (const c of CONTRATOS) todos[c] = await semearContrato(p, c);
  todos.master = (await p.usuario.create({
    data: { nome: 'Master X251', matricula: 'MASTERX251', tipo: 'ADMINISTRADOR', setor: 'GESTAO', nivel: 'MASTER', contrato: '251' },
  })).id;
  return todos;
}
