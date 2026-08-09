# Frontend — Mercado Favalessa ERP

Interface web do sistema, feita em JavaScript puro (sem framework), no mesmo padrão `state` → `render()` → `bind()` do sistema v3 — quem conhece o HTML antigo se localiza aqui.

## Rodando localmente

Sirva a pasta com qualquer servidor estático, com o backend no ar em `localhost:3000`:

```bash
python3 -m http.server 5173
# abra http://localhost:5173
```

Em produção o frontend chama `/api`, então o backend precisa responder no mesmo domínio (ou atrás de um proxy que encaminhe `/api` para ele).

## Arquivos

- `index.html` — casco da página, registra o service worker
- `assets/js/app.js` — estado, telas e eventos
- `assets/js/api.js` — chamadas à API, sessão e token da folha
- `assets/js/helpers.js` — dinheiro (`brl`), datas (`dateBR`, `todayISO` no fuso de São Paulo)
- `manifest.webmanifest` + `sw.js` — PWA instalável na tela inicial do celular

## PWA

O service worker guarda em cache **apenas o casco** (HTML/CSS/JS), para o app abrir rápido e poder ser instalado na tela inicial. Chamadas de API nunca são cacheadas: com três pessoas mexendo no mesmo sistema, mostrar um saldo ou uma conta vencida a partir de cache velho seria pior do que não abrir.

## Telas por perfil

| Tela | Master | Gerente | Loja |
|---|---|---|---|
| Painel do dia | ✅ | ✅ | ❌ |
| Contas a pagar (4 abas) | ✅ | ✅ | ✅ (sem dar baixa) |
| Venda a prazo | ✅ | ✅ | ✅ |
| Conciliação | ✅ | ✅ | ✅ |
| Acumulado | ✅ | ✅ | ❌ |
| Cadastros | ✅ | ✅ | ✅ (sem excluir) |
| Relatórios | ✅ | ✅ | ❌ |
| Folha | ✅ (+ senha) | ❌ | ❌ |
| Administração | ✅ | ❌ | ❌ |

Esconder a aba é conveniência, não segurança: o backend bloqueia todas essas rotas por conta própria.
