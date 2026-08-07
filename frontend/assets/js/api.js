const API_BASE = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? 'http://localhost:3000/api'
  : '/api';

const TOKEN_KEY = 'mf_token';
const USUARIO_KEY = 'mf_usuario';

export function getSessao() {
  const token = localStorage.getItem(TOKEN_KEY);
  const usuarioRaw = localStorage.getItem(USUARIO_KEY);
  if (!token || !usuarioRaw) return null;
  try {
    return { token, usuario: JSON.parse(usuarioRaw) };
  } catch {
    return null;
  }
}

export function salvarSessao(token, usuario) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USUARIO_KEY, JSON.stringify(usuario));
}

export function limparSessao() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USUARIO_KEY);
}

export async function apiFetch(path, opts = {}) {
  const sessao = getSessao();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (sessao) headers.Authorization = `Bearer ${sessao.token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

  if (res.status === 401 && sessao) {
    limparSessao();
    window.location.reload();
    throw new Error('Sessão expirada.');
  }

  const temCorpo = res.status !== 204;
  const isJson = temCorpo && (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new Error((data && data.error) || `Erro na requisição (HTTP ${res.status}).`);
  }
  return data;
}
