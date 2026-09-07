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

// Limite apertado por padrão: nenhum lançamento do sistema chega perto de 1 MB.
//
// As rotas de arquivo são a exceção e trazem o próprio parser, mais largo. Elas
// precisam escapar DESTE aqui, senão o corpo é rejeitado antes de chegar lá — o
// parser da rota nem roda. Era o que acontecia com os extratos: a rota dizia
// 25 MB e o envio morria em 1 MB, que dá menos de 800 KB de planilha depois do
// base64. Rota de arquivo nova precisa entrar nesta lista.
const jsonPadrao = express.json({ limit: '1mb' });

// Cada roteador declara os próprios caminhos de arquivo; aqui eles só ganham o
// prefixo. Assim uma rota de arquivo nova já nasce isenta, sem depender de
// alguém lembrar de mexer neste arquivo.
const comPrefixo = (prefixo, roteador) =>
  (roteador.caminhosComArquivo || []).map((c) => `${prefixo}${c}`);

const ROTAS_COM_ARQUIVO = new Set([
  ...comPrefixo('/api/admin', adminRoutes),
  ...comPrefixo('/api/conciliacao', conciliacaoRoutes),
]);

app.use((req, res, next) => {
  if (ROTAS_COM_ARQUIVO.has(req.path)) return next();
  return jsonPadrao(req, res, next);
});

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
      // `no-cache` não é "não guarde": é "guarde, mas confirme comigo antes de
      // usar". Com ETag a confirmação custa um 304 vazio, e o usuário nunca fica
      // preso a um CSS ou JS de antes do deploy — que foi o que aconteceu quando
      // o navegador continuou mostrando a tela antiga depois de uma atualização.
      etag: true,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache');
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
  if (fs.existsSync(indexHtml)) {
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexHtml);
  }

  return res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use(errorHandler);

module.exports = app;
