const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth.routes');
const fornecedoresRoutes = require('./routes/fornecedores.routes');
const contasRoutes = require('./routes/contas.routes');
const painelRoutes = require('./routes/painel.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/fornecedores', fornecedoresRoutes);
app.use('/api/contas', contasRoutes);
app.use('/api/painel-do-dia', painelRoutes);

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use(errorHandler);

module.exports = app;
