const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth.routes');
const fornecedoresRoutes = require('./routes/fornecedores.routes');
const contasRoutes = require('./routes/contas.routes');
const painelRoutes = require('./routes/painel.routes');
const conciliacaoRoutes = require('./routes/conciliacao.routes');
const acumuladosRoutes = require('./routes/acumulados.routes');
const cadastrosRoutes = require('./routes/cadastros.routes');
const vendaPrazoRoutes = require('./routes/vendaPrazo.routes');
const folhaRoutes = require('./routes/folha.routes');
const relatoriosRoutes = require('./routes/relatorios.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();

// Servindo o frontend do mesmo domínio, produção não precisa de CORS — deixar
// aberto só ampliaria a superfície de ataque. Em desenvolvimento o frontend roda
// em outra porta, então liberamos. `CORS_ORIGIN` cobre o caso de hospedar a
// interface em outro domínio.
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
} else if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/fornecedores', fornecedoresRoutes);
app.use('/api/contas', contasRoutes);
app.use('/api/painel-do-dia', painelRoutes);
app.use('/api/conciliacao', conciliacaoRoutes);
app.use('/api/acumulados', acumuladosRoutes);
app.use('/api/cadastros', cadastrosRoutes);
app.use('/api/venda-prazo', vendaPrazoRoutes);
app.use('/api/folha', folhaRoutes);
app.use('/api/relatorios', relatoriosRoutes);
app.use('/api/admin', adminRoutes);

// Em produção o próprio backend serve o frontend, então a interface e a API
// ficam no mesmo domínio — o `/api` do frontend resolve sozinho, sem proxy nem
// CORS entre hosts diferentes.
const PASTA_FRONTEND = path.join(__dirname, '..', '..', 'frontend');

if (fs.existsSync(path.join(PASTA_FRONTEND, 'index.html'))) {
  app.use(
    express.static(PASTA_FRONTEND, {
      // O casco muda a cada deploy; o service worker não pode ficar preso a uma
      // versão antiga, senão o usuário nunca recebe a atualização.
      setHeaders(res, caminho) {
        if (caminho.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
}

// 404 de API responde JSON; qualquer outro caminho cai no index.html (SPA).
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Rota não encontrada.' });
  }

  const indexHtml = path.join(PASTA_FRONTEND, 'index.html');
  if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml);

  return res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use(errorHandler);

module.exports = app;
