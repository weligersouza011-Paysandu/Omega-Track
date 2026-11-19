# Multi-contrato no OmegaTrack

> **Implantação passo a passo (subir a versão e criar um contrato novo): [IMPLANTACAO_CONTRATO.md](IMPLANTACAO_CONTRATO.md).**
> Comandos: `npm run contrato:verificar` (integridade e relatório por contrato) e `npm run contrato:novo -- --arquivo <pedido.json> [--aplicar]`.

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

## Segurança (camadas)
1. **Rotas:** login obrigatório; Master/setor decidem o que cada perfil acessa.
2. **Controllers:** cada consulta aplica o escopo de contrato (`filtroContrato`, `contratoParaGravar`, `router.param`).
3. **Trava automática na camada de dados** (`src/config/escopoDados.js`): para quem **não é Master**, o cliente Prisma injeta
   `contrato = <do usuário>` em toda leitura/escrita dos modelos de contrato e recusa criar/alterar registro de outro contrato —
   mesmo que um controller novo esqueça o filtro. Consultas globais deliberadas (ex.: unicidade de TAG) usam `semEscopo(...)`.
   Rotas sem login (chave de API) e scripts rodam sem a trava.
4. **Teste de vazamento** (`tests/integracao/vazamento.test.mjs`): roda a pilha real contra **PostgreSQL (PGlite)** com dois contratos
   e dados em todos os módulos; falha se um marcador de um contrato aparecer para o outro (leituras, por ID, escritas, exclusões em lote).
   Rode com `npm test` (não precisa instalar Postgres). **Toda rota nova de dados deve entrar na lista `rotasLeitura` desse teste.**
5. **Login:** limite de tentativas por IP e por matrícula (429) e cabeçalhos de segurança (nosniff, frame-deny, referrer, HSTS em produção).

## Desempenho
- **Semanas da telemetria** são agrupadas no banco (antes: até 200 mil eventos lidos para a memória do servidor). Medido com 96 mil
  eventos num Postgres em memória: 391 ms lendo as linhas → 79 ms agrupando, e 27 linhas na resposta em vez de 96 mil.
  O resultado é idêntico ao do cálculo em JS (teste com virada de ano ISO e a borda do fuso -03:00).
- **Compressão gzip** das respostas (JSON e bundles) e **assets com hash em cache por 1 ano** (`index.html` e service worker sempre revalidam).
- **Frontend:** cada tela é um pacote carregado só quando aberta: o pacote inicial caiu de 2,0 MB para 229 KB (72 KB comprimido).
  As listas completas (frota etc.) têm cache de 20 s, com chamadas simultâneas compartilhadas e limpeza em qualquer escrita.
- **Sessão:** o usuário de cada requisição fica em cache de 10 s no servidor e é descartado na hora em qualquer escrita em usuário
  (contrato, nível, setor, assinatura, exclusão). `CACHE_USUARIO_MS=0` desliga.
- **Índices:** com 120 mil eventos e 36 mil partes, `EXPLAIN` mostra as listagens usando `(contrato, data_hora)` e `(contrato, data)`.

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
