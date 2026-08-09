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

app.use(cors());
app.use(express.json());

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

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use(errorHandler);

module.exports = app;
