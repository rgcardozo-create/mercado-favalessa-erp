export function brl(valor) {
  const n = Number(valor) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function parseMoney(texto) {
  if (typeof texto === 'number') return texto;
  const limpo = String(texto).replace(/[^\d,-]/g, '').replace(',', '.');
  return Number(limpo) || 0;
}

// Datas do backend vêm em ISO (UTC); exibimos em pt-BR sem depender do fuso do navegador.
export function dateBR(isoDate) {
  if (!isoDate) return '';
  const [ano, mes, dia] = isoDate.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

export function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// A tela monta HTML por string; texto vindo do banco (descrição, nome de
// fornecedor) passa por aqui antes de entrar no innerHTML.
export function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
