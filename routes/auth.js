const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendPasswordResetLink } = require('../utils/vk-bot');

module.exports = (app) => {
    const db = app.get('db');

    // Регистрация
    router.post('/register', async (req, res) => {
    console.log('📝 Получен запрос на регистрацию');
    console.log('Тело запроса:', { ...req.body, password: '***' });
    
    const { username, vk_id, password, full_name, team_id } = req.body;
    
    // Валидация
    if (!username || !vk_id || !password || !full_name || !team_id) {
        return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }
    
    // Проверка логина (только латиница, цифры, _)
    const loginRegex = /^[a-zA-Z0-9_]{3,30}$/;
    if (!loginRegex.test(username)) {
        return res.status(400).json({ error: 'Логин может содержать только латинские буквы, цифры и знак подчеркивания (3-30 символов)' });
    }
    
    // Проверка VK ID
    const vkRegex = /^[a-zA-Z0-9_.]+$/;
    if (!vkRegex.test(vk_id)) {
        return res.status(400).json({ error: 'VK ID может содержать только латинские буквы, цифры, точки и знак подчеркивания' });
    }
    
    // Проверка пароля (только латиница, цифры, спецсимволы)
    const passwordRegex = /^[a-zA-Z0-9!@#$%^&*]+$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: 'Пароль может содержать только латинские буквы, цифры и спецсимволы (!@#$%^&*)' });
    }
    
    // Проверка длины пароля
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
    }
    
    try {
        const db = app.get('db');
        
        // Проверка существования пользователя
        const [existing] = await db.execute(
            'SELECT id FROM users WHERE username = ? OR vk_id = ?',
            [username, vk_id]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Пользователь с таким логином или VK ID уже существует' });
        }
        
        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создание пользователя
        const [result] = await db.execute(
            `INSERT INTO users (username, vk_id, password_hash, full_name, team_id, role) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [username, vk_id, hashedPassword, full_name, team_id, 'activist']
        );
        
        console.log('✅ Пользователь создан с ID:', result.insertId);
        res.status(201).json({ 
            message: 'Регистрация успешна', 
            userId: result.insertId 
        });
        
    } catch (error) {
        console.error('❌ Ошибка при регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }

    const [existingVk] = await db.execute(
    'SELECT id FROM users WHERE vk_id = ?',
    [vk_id]
);

if (existingVk.length > 0) {
    return res.status(400).json({ error: 'Пользователь с таким VK ID уже зарегистрирован' });
}
});

    // Завершение регистрации по приглашению
    router.post('/complete-registration', async (req, res) => {
        console.log('📝 Завершение регистрации');
        console.log('Тело запроса:', { ...req.body, password: '***' });
        
        const { token, username, password } = req.body;
        
        if (!token || !username || !password) {
            return res.status(400).json({ error: 'Все поля обязательны' });
        }
        
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();
            
            const [invites] = await connection.execute(
                `SELECT * FROM invitations 
                 WHERE token = ? AND status = 'pending' AND expires_at > NOW()`,
                [token]
            );
            
            if (invites.length === 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'Приглашение недействительно или истекло' });
            }
            
            const invite = invites[0];
            
            const [existing] = await connection.execute(
                'SELECT id FROM users WHERE username = ?',
                [username]
            );
            
            if (existing.length > 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
            }
            
            const hashedPassword = await bcrypt.hash(password, 10);
            
            const [userResult] = await connection.execute(
                `INSERT INTO users (username, vk_id, password_hash, full_name, role, team_id) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [username, invite.vk_id, hashedPassword, invite.full_name, invite.role, invite.team_id]
            );
            
            await connection.execute(
                `UPDATE invitations SET status = 'accepted', accepted_at = NOW() WHERE id = ?`,
                [invite.id]
            );
            
            await connection.commit();
            
            res.json({ message: 'Регистрация успешно завершена', userId: userResult.insertId });
            
        } catch (error) {
            await connection.rollback();
            console.error('❌ Ошибка при завершении регистрации:', error);
            res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
        } finally {
            connection.release();
        }
    });

    router.post('/send-verification-code', async (req, res) => {
    console.log('📝 Запрос на отправку кода подтверждения');
    console.log('Тело запроса:', req.body);
    
    const { vk_id } = req.body;
    
    if (!vk_id) {
        return res.status(400).json({ error: 'VK ID обязателен' });
    }
    
    const normalizedVkId = vk_id.replace('@', '');
    
    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`🔑 Сгенерирован код для ${normalizedVkId}: ${code}`);
    
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // код действителен 10 минут
    
    try {
        // Удаляем старые коды для этого пользователя
        await db.execute('DELETE FROM verification_codes WHERE vk_id = ?', [normalizedVkId]);
        
        // Сохраняем новый код
        await db.execute(
            'INSERT INTO verification_codes (vk_id, code, expires_at) VALUES (?, ?, ?)',
            [normalizedVkId, code, expiresAt]
        );
        
        // Отправляем код через VK бота
        const { sendVerificationCode } = require('../utils/vk-bot');
        const sent = await sendVerificationCode(normalizedVkId, code);
        
        if (sent) {
            console.log(`✅ Код отправлен пользователю ${normalizedVkId}`);
            res.json({ success: true, message: 'Код отправлен' });
        } else {
            console.log(`❌ Не удалось отправить код пользователю ${normalizedVkId}`);
            res.status(500).json({ error: 'Не удалось отправить код. Проверьте VK ID' });
        }
        
    } catch (error) {
        console.error('❌ Ошибка при отправке кода:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }
});

// Подтверждение кода и завершение регистрации
router.post('/verify-code', async (req, res) => {
    console.log('📝 Запрос на подтверждение кода');
    console.log('Тело запроса:', { ...req.body, user_data: { ...req.body.user_data, password: '***' } });
    
    const { vk_id, code, user_data } = req.body;
    
    if (!vk_id || !code || !user_data) {
        return res.status(400).json({ error: 'Не все поля заполнены' });
    }
    
    const normalizedVkId = vk_id.replace('@', '');
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Проверяем код
        const [codes] = await connection.execute(
            'SELECT * FROM verification_codes WHERE vk_id = ? AND code = ? AND used = FALSE AND expires_at > NOW()',
            [normalizedVkId, code]
        );
        
        if (codes.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Неверный или истекший код подтверждения' });
        }
        
        // Отмечаем код как использованный
        await connection.execute(
            'UPDATE verification_codes SET used = TRUE WHERE id = ?',
            [codes[0].id]
        );
        
        // Проверяем, не существует ли уже пользователь
        const [existing] = await connection.execute(
            'SELECT id FROM users WHERE username = ? OR vk_id = ?',
            [user_data.username, normalizedVkId]
        );
        
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Пользователь с таким логином или VK ID уже существует' });
        }
        
        // Проверка пароля
        const passwordRegex = /^[a-zA-Z0-9!@#$%^&*]+$/;
        if (!passwordRegex.test(user_data.password)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Пароль может содержать только латинские буквы, цифры и спецсимволы (!@#$%^&*)' });
        }
        
        if (user_data.password.length < 6) {
            await connection.rollback();
            return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
        }
        
        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(user_data.password, 10);
        
        // Создаем пользователя
        const [result] = await connection.execute(
            `INSERT INTO users (username, vk_id, password_hash, full_name, team_id, role) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [user_data.username, normalizedVkId, hashedPassword, user_data.full_name, user_data.team_id, 'activist']
        );
        
        await connection.commit();
        
        console.log(`✅ Пользователь создан с ID: ${result.insertId}`);
        res.json({ success: true, message: 'Регистрация успешно завершена', userId: result.insertId });
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Ошибка при подтверждении кода:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    } finally {
        connection.release();
    }
});

    // Вход
    router.post('/login', async (req, res) => {
        console.log('📝 Запрос на вход');
        console.log('Тело запроса:', req.body);
        
        const login = req.body.login || req.body.username;
        const { password } = req.body;
        
        if (!login || !password) {
            return res.status(400).json({ error: 'Введите логин и пароль' });
        }
        
        try {
            const normalizedLogin = login.replace('@', '');
            
            const [users] = await db.execute(
                'SELECT * FROM users WHERE username = ? OR vk_id = ?',
                [normalizedLogin, normalizedLogin]
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
            res.json({ message: 'Вход выполнен успешно', role: user.role, redirect: '/dashboard' });
            
        } catch (error) {
            console.error('❌ Ошибка при входе:', error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Выход
    router.post('/logout', (req, res) => {
        res.clearCookie('token');
        res.json({ message: 'Выход выполнен успешно' });
    });

    // Восстановление пароля - запрос
    router.post('/forgot-password', async (req, res) => {
        console.log('📝 Запрос на восстановление пароля');
        console.log('Тело запроса:', req.body);
        
        const { vk_id } = req.body;
        
        try {
            const normalizedVkId = vk_id.replace('@', '');
            
            const [users] = await db.execute(
                'SELECT id, username FROM users WHERE vk_id = ?',
                [normalizedVkId]
            );
            
            if (users.length === 0) {
                return res.status(404).json({ error: 'Пользователь с таким VK ID не найден' });
            }
            
            const user = users[0];
            const token = crypto.randomBytes(32).toString('hex');
            
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 1);
            
            await db.execute(
                `INSERT INTO password_resets (user_id, vk_id, token, expires_at) 
                 VALUES (?, ?, ?, ?)`,
                [user.id, normalizedVkId, token, expiresAt]
            );
            
            const resetLink = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;
            const sent = await sendPasswordResetLink(normalizedVkId, resetLink);
            
            if (sent) {
                res.json({ message: 'Ссылка для сброса пароля отправлена в VK', debug_link: resetLink });
            } else {
                res.status(500).json({ error: 'Не удалось отправить сообщение в VK' });
            }
            
        } catch (error) {
            console.error('❌ Ошибка при восстановлении пароля:', error);
            res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
        }
    });

    // Сброс пароля по токену
    router.post('/reset-password', async (req, res) => {
    console.log('📝 Запрос на сброс пароля');
    console.log('Тело запроса:', { ...req.body, password: '***' });
    
    const { token, password } = req.body;
    
    if (!token || !password) {
        return res.status(400).json({ error: 'Не указан токен или пароль' });
    }
    
    // Проверка пароля на сервере
    const latinRegex = /^[a-zA-Z0-9!@#$%^&*]+$/;
    if (!latinRegex.test(password)) {
        return res.status(400).json({ error: 'Пароль может содержать только латинские буквы, цифры и спецсимволы (!@#$%^&*)' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
    }
    
    if (!/[A-Z]/.test(password)) {
        return res.status(400).json({ error: 'Пароль должен содержать хотя бы одну заглавную букву' });
    }
    
    if (!/[a-z]/.test(password)) {
        return res.status(400).json({ error: 'Пароль должен содержать хотя бы одну строчную букву' });
    }
    
    if (!/[0-9]/.test(password)) {
        return res.status(400).json({ error: 'Пароль должен содержать хотя бы одну цифру' });
    }
    
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const [resets] = await connection.execute(
            `SELECT * FROM password_resets 
             WHERE token = ? AND used = FALSE AND expires_at > NOW()`,
            [token]
        );
        
        if (resets.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Недействительная или устаревшая ссылка' });
        }
        
        const reset = resets[0];
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await connection.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [hashedPassword, reset.user_id]
        );
        
        await connection.execute(
            'UPDATE password_resets SET used = TRUE WHERE id = ?',
            [reset.id]
        );
        
        await connection.commit();
        
        res.json({ message: 'Пароль успешно изменен' });
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Ошибка при сбросе пароля:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    } finally {
        connection.release();
    }
});

    // Получение информации о приглашении
    router.get('/invitation/:token', async (req, res) => {
        console.log('📝 Запрос приглашения с токеном:', req.params.token);
        
        try {
            const [invites] = await db.execute(
                `SELECT i.*, t.name as team_name 
                 FROM invitations i
                 LEFT JOIN teams t ON i.team_id = t.id
                 WHERE i.token = ? AND i.status = 'pending' AND i.expires_at > NOW()`,
                [req.params.token]
            );
            
            if (invites.length === 0) {
                return res.status(404).json({ error: 'Приглашение недействительно или истекло' });
            }
            
            const invite = invites[0];
            res.json({
                full_name: invite.full_name,
                vk_id: invite.vk_id,
                role: invite.role,
                team_name: invite.team_name
            });
            
        } catch (error) {
            console.error('❌ Ошибка при получении приглашения:', error);
            res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
        }
    });

    return router;
};