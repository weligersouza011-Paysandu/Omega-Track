// ============================================================================
// tests/helpers/prismaTelemetriaEmMemoria.mjs
//
// Cliente Prisma em memória, só com o que o módulo de Telemetria usa, para testar
// a API de ponta a ponta (HTTP + multer + controller + parser) sem banco.
// Instale ANTES de importar src/app.js:  globalThis.prisma = criarPrismaEmMemoria(...)
// (src/config/database.js reaproveita `globalThis.prisma`).
// ============================================================================
import { randomUUID } from 'crypto';

const valorDe = (v) => (v instanceof Date ? v.getTime() : v);

/** Avalia o subconjunto de `where` do Prisma usado pelo telemetriaController. */
function atende(registro, where = {}) {
  return Object.entries(where).every(([campo, condicao]) => {
    if (campo === 'OR') return condicao.some((c) => atende(registro, c));
    if (campo === 'AND') return condicao.every((c) => atende(registro, c));
    if (campo === 'NOT') return !atende(registro, condicao);
    // Campo ausente = NULL (como no banco).
    const valor = registro[campo] ?? null;
    if (condicao === null || typeof condicao !== 'object' || condicao instanceof Date) {
      return valorDe(valor) === valorDe(condicao);
    }
    return Object.entries(condicao).every(([op, alvo]) => {
      switch (op) {
        case 'in': return alvo.map(valorDe).includes(valorDe(valor));
        case 'notIn': return valor !== null && !alvo.map(valorDe).includes(valorDe(valor));
        case 'not': return alvo !== null && typeof alvo === 'object' ? !atende({ v: valor }, { v: alvo }) : valor !== alvo;
        case 'contains': {
          const texto = String(valor ?? '');
          return condicao.mode === 'insensitive' ? texto.toLowerCase().includes(String(alvo).toLowerCase()) : texto.includes(alvo);
        }
        case 'mode': return true;
        case 'gte': return valor !== null && valorDe(valor) >= valorDe(alvo);
        case 'gt': return valor !== null && valorDe(valor) > valorDe(alvo);
        case 'lte': return valor !== null && valorDe(valor) <= valorDe(alvo);
        case 'lt': return valor !== null && valorDe(valor) < valorDe(alvo);
        case 'equals': return valorDe(valor) === valorDe(alvo);
        default: throw new Error(`Operador nao suportado no prisma em memoria: ${op}`);
      }
    });
  });
}

function ordenar(lista, orderBy) {
  const criterios = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [])
    .flatMap((o) => Object.entries(o));
  return [...lista].sort((a, b) => {
    for (const [campo, direcao] of criterios) {
      const va = valorDe(a[campo]);
      const vb = valorDe(b[campo]);
      if (va === vb) continue;
      return (va < vb ? -1 : 1) * (direcao === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, registro[k]]));
}

export function criarPrismaEmMemoria({ veiculos = [], administradores = [] } = {}) {
  const eventos = [];
  const logs = [];

  const eventoTelemetria = {
    async createMany({ data, skipDuplicates }) {
      let count = 0;
      for (const item of data) {
        if (eventos.some((e) => e.chave_unica === item.chave_unica)) {
          if (skipDuplicates) continue;
          throw Object.assign(new Error('Unique constraint failed'), { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['chave_unica'] } });
        }
        const agora = new Date();
        eventos.push({
          status_tratativa: 'PENDENTE', origem: 'MANUAL', medida_aplicada: null, observacao_tratativa: null,
          tratado_por: null, tratado_em: null, ...item, id: randomUUID(), created_at: agora, updated_at: agora,
        });
        count += 1;
      }
      return { count };
    },
    async create({ data }) {
      await eventoTelemetria.createMany({ data: [data] });
      return { ...eventos[eventos.length - 1] };
    },
    async findMany({ where, orderBy, skip = 0, take, select, distinct } = {}) {
      let lista = ordenar(eventos.filter((e) => atende(e, where)), orderBy);
      if (distinct) {
        const vistos = new Set();
        lista = lista.filter((e) => { const k = distinct.map((c) => e[c]).join('|'); if (vistos.has(k)) return false; vistos.add(k); return true; });
      }
      return lista.slice(skip, take === undefined ? undefined : skip + take).map((e) => selecionar(e, select));
    },
    async findUnique({ where }) {
      const e = eventos.find((x) => x.id === where.id);
      return e ? { ...e } : null;
    },
    async aggregate({ where, _min = {}, _max = {} } = {}) {
      const lista = eventos.filter((e) => atende(e, where));
      const extremo = (campos, fn) => Object.fromEntries(Object.keys(campos).map((c) => {
        const valores = lista.map((e) => e[c]).filter((v) => v !== null && v !== undefined);
        return [c, valores.length ? valores.reduce((a, b) => (fn(valorDe(b), valorDe(a)) ? b : a)) : null];
      }));
      return { _count: { _all: lista.length }, _min: extremo(_min, (b, a) => b < a), _max: extremo(_max, (b, a) => b > a) };
    },
    async count({ where } = {}) {
      return eventos.filter((e) => atende(e, where)).length;
    },
    async groupBy({ by, where, _min, _max }) {
      const grupos = new Map();
      for (const e of eventos.filter((x) => atende(x, where))) {
        const chave = by.map((c) => e[c] ?? null).join('|');
        const g = grupos.get(chave) || {
          ...Object.fromEntries(by.map((c) => [c, e[c] ?? null])),
          _count: { _all: 0 },
          ...(_min ? { _min: Object.fromEntries(Object.keys(_min).map((c) => [c, null])) } : {}),
          ...(_max ? { _max: Object.fromEntries(Object.keys(_max).map((c) => [c, null])) } : {}),
        };
        g._count._all += 1;
        for (const c of Object.keys(_min || {})) {
          if (e[c] != null && (g._min[c] === null || valorDe(e[c]) < valorDe(g._min[c]))) g._min[c] = e[c];
        }
        for (const c of Object.keys(_max || {})) {
          if (e[c] != null && (g._max[c] === null || valorDe(e[c]) > valorDe(g._max[c]))) g._max[c] = e[c];
        }
        grupos.set(chave, g);
      }
      return [...grupos.values()];
    },
    async update({ where, data }) {
      const e = eventos.find((x) => x.id === where.id);
      if (!e) throw Object.assign(new Error('not found'), { name: 'PrismaClientKnownRequestError', code: 'P2025' });
      Object.assign(e, data, { updated_at: new Date() });
      return { ...e };
    },
    async updateMany({ where, data }) {
      const alvo = eventos.filter((e) => atende(e, where));
      alvo.forEach((e) => Object.assign(e, data, { updated_at: new Date() }));
      return { count: alvo.length };
    },
    async deleteMany({ where }) {
      const antes = eventos.length;
      const manter = eventos.filter((e) => !atende(e, where));
      eventos.splice(0, eventos.length, ...manter);
      return { count: antes - eventos.length };
    },
  };

  const planos = [];
  const planoAcaoTelemetria = {
    async create({ data }) {
      const agora = new Date();
      const plano = {
        tipo: 'FADIGA', tag_placa: null, elegivel_prontidao: null, analise: null, acoes: [], responsavel: null,
        prazo: null, status: 'ABERTO', conclusao: null, concluido_em: null, criado_por: null,
        ...data, id: randomUUID(), created_at: agora, updated_at: agora,
      };
      planos.push(plano);
      return { ...plano };
    },
    async findMany({ where, orderBy, take, select } = {}) {
      return ordenar(planos.filter((p) => atende(p, where)), orderBy).slice(0, take).map((p) => selecionar(p, select));
    },
    async findUnique({ where }) {
      const p = planos.find((x) => x.id === where.id);
      return p ? { ...p } : null;
    },
    async update({ where, data }) {
      const p = planos.find((x) => x.id === where.id);
      if (!p) throw Object.assign(new Error('not found'), { name: 'PrismaClientKnownRequestError', code: 'P2025' });
      Object.assign(p, data, { updated_at: new Date() });
      return { ...p };
    },
    async deleteMany({ where }) {
      const antes = planos.length;
      const manter = planos.filter((p) => !atende(p, where));
      planos.splice(0, planos.length, ...manter);
      return { count: antes - planos.length };
    },
  };

  const usuarios = administradores.map((u) => ({ tipo: 'ADMINISTRADOR', setor: 'GESTAO', nivel: 'MASTER', ...u }));

  return {
    eventos,
    logs,
    planos,
    eventoTelemetria,
    planoAcaoTelemetria,
    mobDesmob: { async findMany() { return veiculos.map((v) => ({ ...v })); } },
    usuario: {
      async findUnique({ where }) { return usuarios.find((u) => u.id === where.id) || null; },
      async findFirst({ where }) { return usuarios.find((u) => atende(u, where)) || null; },
    },
    logAtividade: { async create({ data }) { logs.push(data); return data; } },
    async $transaction(operacoes) { return Promise.all(operacoes); },
    async $connect() {},
    async $disconnect() {},
  };
}
