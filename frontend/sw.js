// Service worker do PWA.
//
// Estratégia deliberada: só o "casco" do app (HTML/CSS/JS) fica em cache, para
// abrir rápido e instalar na tela inicial do celular. Chamadas de API NUNCA são
// cacheadas — num sistema com três pessoas mexendo ao mesmo tempo, mostrar saldo
// ou conta vencida a partir de cache velho seria pior do que não abrir.
// Trocar o nome descarta o cache antigo inteiro no `activate` — é o que garante
// que ninguém fique com o casco de um deploy anterior.
const CACHE = 'mf-casco-v3';

const CASCO = [
  './',
  './index.html',
  './assets/css/app.css',
  './assets/js/app.js',
  './assets/js/api.js',
  './assets/js/helpers.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCO)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);

  // API e qualquer coisa que não seja GET passam direto para a rede.
  if (ev.request.method !== 'GET' || url.pathname.startsWith('/api')) return;

  // Casco: rede primeiro (para pegar atualização), cache como reserva offline.
  ev.respondWith(
    fetch(ev.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(ev.request, copia)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(ev.request).then((r) => r || caches.match('./index.html')))
  );
});
