# Multi-contrato no OmegaTrack

Resumo das regras, de como operar e do roteiro de entrada em produção.

## Regras
- **Contrato** = código de **3 números** (ex.: `251`, `010`), sem espaço ou outro caractere (o banco também recusa
  outros formatos). Não há cadastro de contratos: ele "existe" a partir do primeiro usuário/veículo/obra cadastrado nele.
- **Cada usuário pertence a UM contrato.** Quem **não é Master** só enxerga e grava dados do próprio contrato.
  O **Master** vê todos: `?contrato=010` escolhe um, `?contrato=todos` junta tudo; sem parâmetro vale o contrato dele.
  Registro de outro contrato responde **404**.
- **Setores:** Gestão/Planejador veem tudo do contrato; Transporte vê tudo, mas os módulos ambientais só em leitura;
  Meio Ambiente vê EcoGestão, Controle Ambiental, Combustível e a mobilização da frota (informações essenciais; edita só
  o combustível).
- **Importações e lançamentos** gravam o contrato de quem importa (telemetria: só veículos mobilizados nesse contrato).
- **Troca de contrato** (só Master): `POST /api/mob-desmob/:tag/transferir-contrato` e
  `POST /api/usuarios/:id/transferir-contrato`, com `data_efetiva`. Do dia em diante os registros do veículo passam ao
  contrato novo; o que veio antes permanece no antigo (`veiculo_contrato_historico`).
- **Excluir usuário** não apaga o histórico (os registros guardam nome e matrícula em texto).
- **Paginação:** listagens têm teto de 500 itens por página (`?page=&limit=`); as telas que precisam de todos os
  registros buscam página a página.

## Locação (dentro do contrato)
O que o sistema antigo chamava de "contrato" (Eletromecânica, Serra Leste) eram as **locações** do contrato 251. Cada veículo tem uma
`locacao` opcional; a lista de locações de um contrato vem dos próprios veículos (nome normalizado: sem acento/caixa, sem duplicar).
Ela é **obrigatória no cadastro** só nos contratos que já usam locações. Indicador: `GET /api/mob-desmob/locacoes`
(mobilizados/desmobilizados por locação) e o filtro lateral da Frota, o Dashboard Executivo e a Eficiência (`?locacao=`).
Regras de preventiva valem por **locação > contrato > global**. Ao transferir um veículo de contrato, a locação passa a ser a do contrato novo.
Valores antigos sem correspondência (ex.: "CT-251", "Sondagem") ficam **sem locação** e aparecem como "Sem locação" para ajuste na Frota.

## Migrations (0038–0042)
| Migration | O que faz |
|---|---|
| 0038 | setor `PLANEJADOR` |
| 0039 | coluna `contrato` (3 dígitos, com CHECK) em todas as tabelas de dados; **tudo que existe vira `251`**; histórico de contrato por veículo; backup dos valores antigos em `contrato_legado_backup` |
| 0040 | remove o `DEFAULT '251'` transitório (a aplicação passa a gravar o contrato) |
| 0041 | índices compostos por contrato |
| 0042 | **locação** (Serra Norte / Serra Leste) em veículos, abastecimentos e regras de preventiva; restaura do `contrato_legado_backup` os nomes antigos (Eletromecânica → Serra Norte; Serra Leste → Serra Leste) |

## Roteiro de entrada em produção
1. **Backup** do banco antes de qualquer coisa.
2. Rodar as migrations em uma **cópia** do banco e conferir:
   - `SELECT contrato, count(*) FROM usuarios GROUP BY 1;` → só `251`;
   - `SELECT tabela, count(*) FROM contrato_legado_backup GROUP BY 1;` → conferir os valores antigos
     (ex.: `CT-251`, nomes de contrato) que foram unificados em `251`.
3. Subir o backend e o frontend juntos (o frontend novo envia o token em todas as chamadas; o backend novo exige login).
4. Conferir logins por perfil (Master, Gestão, Transporte, Meio Ambiente, Operacional) e o filtro de contrato no topo.
5. Só depois cadastrar o **segundo contrato** (primeiro usuário/veículo com o novo código).
6. Com o segundo contrato rodando e estável, `contrato_legado_backup` pode ser apagada.

## Reversão
- Antes da 0040/0041: restaurar o backup. Os valores antigos de contrato ficam em `contrato_legado_backup`
  (`tabela`, `chave`, `contrato_antigo`; parâmetros de preventiva removidos ficam em `dados`).
- Não há reversão automática depois que dados novos forem gravados com contratos diferentes: restaure o backup.
