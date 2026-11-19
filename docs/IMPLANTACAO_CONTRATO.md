# Implantação multi-contrato — roteiro passo a passo

Dois momentos: **(A)** subir a versão multi-contrato sobre o banco atual (contrato 251) e **(B)** implantar um **contrato novo**
(por exemplo, um contrato menor). Faça o A inteiro e estável antes do B.

Regras e arquitetura: [MULTI_CONTRATO.md](MULTI_CONTRATO.md).

---

## A) Subir a versão multi-contrato (banco atual → contrato 251)

### A1. Backup e ensaio (não pule)
1. **Backup** do banco de produção. Se for Neon, crie um **branch** a partir da produção (cópia instantânea para o ensaio);
   senão: `pg_dump --format=custom --file=omega-antes.dump "<DATABASE_URL>"`.
2. Aponte uma cópia do projeto para a **cópia** do banco (`DATABASE_URL` da cópia) e rode:
   ```powershell
   npx prisma migrate deploy      # aplica 0038 a 0042
   npm run contrato:verificar
   ```
3. Leia o relatório `contrato:verificar`:
   - **Registros por contrato**: deve haver só o contrato `251` (com os totais que você já conhece).
   - **Verificações**: nenhum `✖`. Avisos (`!`) são para conferir: veículo sem locação, sem histórico etc.
   - **Valores antigos de contrato**: mostra o que a padronização fez com cada valor antigo. `Eletromecânica → Serra Norte` e
     `Serra Leste → Serra Leste`; **qualquer outro valor (ex.: `CT-251`, `Sondagem`) fica "sem locação"**. Se algum deles deveria
     ser uma locação, decida agora (dá para ajustar na tela de Frota ou pedir um mapeamento).
4. Abra o sistema apontando para a cópia e passe o **roteiro de perfis** (A3).

### A2. Deploy
1. Aplique as migrations no banco de produção (`npx prisma migrate deploy` ou o deploy do Render).
2. Suba **backend e frontend juntos** (o frontend novo envia o login em todas as chamadas; o backend novo exige login).
3. Avise os usuários para **recarregar a página** (Ctrl+Shift+R). O sistema é um PWA e pode manter a versão antiga em cache.
4. Rode `npm run contrato:verificar` contra a produção: precisa terminar sem erro.

### A3. Roteiro de perfis (marque cada linha)
| Perfil | O que conferir |
|---|---|
| Master | filtro de contrato no topo (troca e "Todos"); cadastrar algo em "Todos" pede para escolher contrato; Transferir contrato abre a janela |
| Gestão / Planejador | vê tudo do contrato 251; Obras com Planejador; aprova RDO em lote |
| Transporte | frota, programação, RDO, telemetria; módulos ambientais só leitura (aviso amarelo, botões bloqueados pela API) |
| Meio Ambiente | só EcoGestão, Controle Ambiental, Combustível e Mobilização; na frota só edita o combustível |
| Operacional | entra só com a matrícula, vê só as próprias partes diárias |
| Qualquer um | recarregar a página mantém o login; sair e entrar de novo funciona |

---

## B) Implantar um contrato novo

### B1. Prepare o pedido
Copie `scripts/modelo-novo-contrato.json` e edite (código de 3 números do contrato; administradores com setor; operacionais; obras):
- É obrigatório ao menos **1 administrador GESTAO** (ele cadastra os demais usuários do contrato).
- O kit **nunca cria Master** (só um Master promove outro Master).
- Administrador sem `senha` no arquivo recebe uma **senha provisória**, mostrada **uma única vez**; o banco guarda só o hash.
- A obra pode apontar `planejador_matricula` de um administrador PLANEJADOR do mesmo pedido.
- **A matrícula é única em todos os contratos.** Use matrículas que ainda não existam.

### B2. Simule e aplique
```powershell
npm run contrato:novo -- --arquivo contrato-010.json            # simulação: lista o que seria criado e os erros
npm run contrato:novo -- --arquivo contrato-010.json --aplicar  # grava
```
O kit recusa contrato que **já existe** (não duplica nem sobrescreve) e mostra todos os erros do pedido de uma vez.
Anote as senhas provisórias na hora e passe cada uma só para a pessoa; peça para trocarem em **Meu Perfil** no primeiro acesso.

### B3. Primeiro acesso do contrato novo
1. Entre com a Gestão do contrato novo: o topo mostra **"Contrato 010"** fixo, e Frota/Obras/Usuários aparecem **vazios de dados do 251**.
2. **Cadastre o primeiro veículo informando a Locação** (se o contrato usa locações): é assim que a lista de locações nasce
   (a Locação é obrigatória no cadastro só depois que o contrato já tem alguma).
3. Cadastre os demais usuários (Gestão de Usuários → eles herdam o contrato 010) e, se precisar, os Parâmetros de Preventiva do contrato.
4. Importações (EcoGestão, Combustível, Telemetria) já gravam no contrato de quem importa; a telemetria só aceita veículos mobilizados nesse contrato.

### B4. Confira o isolamento (obrigatório antes de liberar para o contrato)
1. Com o login da Gestão do 010, procure por tags/obras/usuários do 251: **não pode aparecer nada**.
2. Com o login de um usuário do 251, **não pode aparecer nada do 010**.
3. Como Master, troque o filtro entre 251, 010 e "Todos": cada um mostra só o que é seu.
4. `npm run contrato:verificar`: sem `✖`; o contrato 010 aparece com os totais esperados.

---

## Dia a dia
- **Trocar veículo ou usuário de contrato:** só o Master, em "Transferir…" (pede o dia da troca; o histórico anterior fica no contrato antigo).
- **Usuário que saiu:** excluir é seguro (as partes/lançamentos guardam o nome e a matrícula em texto).
- **Rota nova de dados no sistema:** inclua-a na lista de rotas de `tests/integracao/vazamento.test.mjs` e rode `npm test`.
- **Depois de estável** (com o segundo contrato rodando), a tabela `contrato_legado_backup` pode ser apagada.

## Se algo der errado
- **Antes de dados novos em outros contratos:** restaure o backup do passo A1.
- **Contrato novo criado errado e ainda sem uso:** peça para apagar os registros desse contrato (usuários e obras criados pelo kit) —
  não há "desfazer" automático; por isso a simulação existe.
- **Valor antigo mal mapeado para locação:** corrija na tela de Frota (ou me peça um mapeamento); o backup guarda o valor original.

## Limites conhecidos
- Não há tela para criar contrato: o contrato existe a partir do primeiro cadastro (o kit faz esse primeiro cadastro).
- O limite de tentativas de login e o cache de sessão são **por instância** do servidor.
- Os testes automáticos usam PostgreSQL em memória (PGlite); o ensaio na **cópia do banco real** (A1) continua sendo necessário.
