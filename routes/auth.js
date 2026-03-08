const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = (app) => {
    const db = app.get('db');

    // Регистрация
    router.post('/register', async (req, res) => {
        const { username, email, password, full_name, team_id } = req.body;
        
        try {
            const [existing] = await db.execute(
                'SELECT id FROM users WHERE username = ? OR email = ?',
                [username, email]
            );
            
            if (existing.length > 0) {
                return res.status(400).json({ error: 'Пользователь уже существует' });
            }
            
            const hashedPassword = await bcrypt.hash(password, 10);
            
            const [result] = await db.execute(
                'INSERT INTO users (username, email, password_hash, full_name, team_id, role) VALUES (?, ?, ?, ?, ?, ?)',
                [username, email, hashedPassword, full_name, team_id || null, 'activist']
            );
            
            res.status(201).json({ message: 'Регистрация успешна', userId: result.insertId });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.post('/login', async (req, res) => {
        const { username, password } = req.body;
        
        try {
            const [users] = await db.execute(
                'SELECT * FROM users WHERE username = ?',
                [username]
            );
            
            if (users.length === 0) {
                return res.status(401).json({ error: 'Неверные учетные данные' });
            }
            
            const user = users[0];
            const validPassword = await bcrypt.compare(password, user.password_hash);
            
            if (!validPassword) {
                return res.status(401).json({ error: 'Неверные учетные данные' });
            }
            
            const token = jwt.sign(
                { userId: user.id, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            res.cookie('token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
            res.json({ 
                message: 'Вход выполнен успешно', 
                role: user.role,
                redirect: '/dashboard'
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.post('/logout', (req, res) => {
        res.clearCookie('token');
        res.json({ message: 'Выход выполнен успешно' });
    });

    return router;
};