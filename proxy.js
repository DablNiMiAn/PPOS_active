// proxy.js
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// Разрешаем CORS для всех
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Прокси для вашего API
app.use('/', createProxyMiddleware({
    target: 'http://localhost:3000',
    changeOrigin: true,
    ws: true,
    onProxyReq: (proxyReq, req, res) => {
        console.log(`📡 Прокси: ${req.method} ${req.url} -> http://localhost:3000${req.url}`);
    }
}));

const PORT = 8080;
app.listen(PORT, () => {
    console.log(`✅ CORS прокси запущен на http://localhost:${PORT}`);
    console.log(`🔗 Используйте: http://localhost:${PORT}/api/... для API запросов`);
});