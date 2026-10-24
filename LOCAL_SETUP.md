# Executar OmegaTrack neste Windows

## Pré-requisitos

- Node.js 18 ou superior e npm.
- PostgreSQL 18 instalado em Program Files. O script cria uma instância separada do serviço já existente.

## Primeira execução e próximas vezes

No PowerShell, na raiz deste projeto:

1. Execute `npm run local:start`.
2. Abra http://localhost:5173.
3. Para encerrar, execute `npm run local:stop`. O comando desliga API e interface; no modo isolado, desliga também o PostgreSQL criado pelo projeto. Os dados continuam salvos.

Na configuração inicial, o primeiro comando cria uma instância PostgreSQL local na porta 55432, gera credenciais aleatórias em `.env`, cria o banco `omegatrack_dev`, instala dependências ausentes, gera o Prisma Client e aplica as migrações. O banco fica em `.local/postgres-data`. A pasta `.local` e o arquivo `.env` são ignorados pelo Git. As próximas execuções reutilizam esses dados. Após a migração descrita abaixo, os comandos usam a porta 5432.

Se quiser apenas preparar o banco sem abrir a interface, use `npm run local:setup`.

## Migrar para o PostgreSQL padrão

Para colocar o banco na conexão `postgres` do DBeaver (`127.0.0.1:5432`), execute `npm run local:migrate-default` e informe o usuário e a senha dessa conexão no prompt local. O comando cria `omegatrack_dev` na porta 5432 somente se esse nome ainda não existir, exporta o banco isolado, restaura os dados, confere as contagens das tabelas e atualiza o `.env`. O banco antigo e os backups ficam preservados em `.local/`. Depois da migração, `local:start` usa o banco da porta 5432, e `local:stop` não desliga o serviço PostgreSQL padrão.

## Conta inicial

Depois de iniciar a aplicação pela primeira vez, execute `npm run local:admin` em outro PowerShell na raiz do projeto. Informe nome, matrícula e senha nos prompts. O comando só cria a conta se ainda não houver administrador. Em seguida, entre na interface com essa matrícula e senha. Use uma senha exclusiva para este ambiente local.

## Uploads e limites

As credenciais do Cloudinary são opcionais para iniciar a aplicação. Sem elas, a API retorna 503 nas rotas de upload. Para habilitar fotos e anexos, preencha CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET no `.env`.

Os logs ficam em `.local/logs`. A aplicação local usa dados separados de qualquer implantação publicada. As questões de autorização identificadas na análise técnica continuam presentes; mantenha esta instância restrita à própria máquina.
