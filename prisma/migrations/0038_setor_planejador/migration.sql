-- Novo setor PLANEJADOR (mesmas atribuicoes da Gestao). Em migration propria
-- porque ALTER TYPE ... ADD VALUE nao pode conviver com outros usos do enum
-- na mesma transacao em versoes antigas do PostgreSQL.
ALTER TYPE "SetorUsuario" ADD VALUE IF NOT EXISTS 'PLANEJADOR';
