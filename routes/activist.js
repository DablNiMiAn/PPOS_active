const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
};

module.exports = (app) => {
    const db = app.get('db');

    router.get('/team-rating/:teamId', authenticateToken, async (req, res) => {
        try {
            const [users] = await db.execute(
                `SELECT u.id, u.full_name, u.total_rating 
                 FROM users u 
                 WHERE u.team_id = ? AND u.role IN ('activist', 'chairman')
                 ORDER BY u.total_rating DESC`,
                [req.params.teamId]
            );
            res.json(users);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.get('/global-rating', authenticateToken, async (req, res) => {
        try {
            const [users] = await db.execute(
                `SELECT u.id, u.full_name, u.total_rating, t.name as team_name 
                 FROM users u 
                 LEFT JOIN teams t ON u.team_id = t.id 
                 WHERE u.role IN ('activist', 'chairman')
                 ORDER BY u.total_rating DESC 
                 LIMIT 50`
            );
            res.json(users);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.get('/user-events/:userId', authenticateToken, async (req, res) => {
        try {
            const [events] = await db.execute(
                `SELECT e.*, ep.role, ep.points_earned 
                 FROM events e 
                 JOIN event_participations ep ON e.id = ep.event_id 
                 WHERE ep.user_id = ? 
                 ORDER BY e.event_date DESC`,
                [req.params.userId]
            );
            res.json(events);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.get('/user-achievements/:userId', authenticateToken, async (req, res) => {
        try {
            const [achievements] = await db.execute(
                `SELECT * FROM achievements 
                 WHERE user_id = ? 
                 ORDER BY created_at DESC`,
                [req.params.userId]
            );
            res.json(achievements);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.get('/teams', async (req, res) => {
        try {
            const [teams] = await db.execute('SELECT id, name FROM teams ORDER BY name');
            res.json(teams);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

router.get('/user-rating-details/:userId', authenticateToken, async (req, res) => {
    try {
        const db = app.get('db');
        
        // Сумма баллов с мероприятий
        const [events] = await db.execute(
            `SELECT COALESCE(SUM(ep.points_earned), 0) as total
             FROM event_participations ep
             JOIN events e ON ep.event_id = e.id
             WHERE ep.user_id = ? AND e.status = 'approved'`,
            [req.params.userId]
        );
        
        // Сумма баллов с достижений
        const [achievements] = await db.execute(
            `SELECT COALESCE(SUM(points), 0) as total
             FROM achievements
             WHERE user_id = ? AND status = 'approved'`,
            [req.params.userId]
        );
        
        // Сумма штрафов (они уже отрицательные)
        const [penalties] = await db.execute(
            `SELECT COALESCE(SUM(points), 0) as total
             FROM penalties
             WHERE user_id = ?`,
            [req.params.userId]
        );
        
        res.json({
            eventsPoints: events[0].total,
            achievementsPoints: achievements[0].total,
            penaltyPoints: Math.abs(penalties[0].total) // Для отображения берем абсолютное значение
        });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

router.post('/achievement', authenticateToken, async (req, res) => {
    console.log('📝 Создание достижения активистом');
    console.log('Тело запроса:', req.body);
    
    const { title, description, points } = req.body;
    
    // Валидация
    if (!title || !description || !points) {
        return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }
    
    if (points < 1) {
        return res.status(400).json({ error: 'Баллы должны быть больше 0' });
    }
    
    if (title.length < 3) {
        return res.status(400).json({ error: 'Название должно содержать минимум 3 символа' });
    }
    
    if (description.length < 10) {
        return res.status(400).json({ error: 'Описание должно содержать минимум 10 символов' });
    }
    
    try {
        const db = app.get('db');
        
        // Создаем достижение со статусом pending
        const [result] = await db.execute(
            `INSERT INTO achievements (user_id, title, description, points, status, created_by) 
             VALUES (?, ?, ?, ?, 'pending', ?)`,
            [req.user.userId, title, description, points, req.user.userId]
        );
        
        console.log('✅ Достижение создано, ID:', result.insertId);
        
        // Получаем информацию о пользователе для уведомления
        const [user] = await db.execute(
            'SELECT full_name FROM users WHERE id = ?',
            [req.user.userId]
        );
        
        // Отправляем уведомление специалистам
        const [specialists] = await db.execute(
            'SELECT id FROM users WHERE role = "specialist"'
        );
        
        for (const specialist of specialists) {
            await db.execute(
    `INSERT INTO notifications (user_id, title, message, type, related_id, created_at) 
     VALUES (?, ?, ?, 'info', ?, NOW())`,
    [specialist.id, 'Новое достижение на модерации', 
     `Пользователь "${user[0].full_name}" добавил достижение "${title}" на ${points} баллов`, 
     result.insertId]
);
        }
        
        res.status(201).json({ 
            message: 'Достижение отправлено на модерацию', 
            achievementId: result.insertId 
        });
        
    } catch (error) {
        console.error('❌ Ошибка при создании достижения:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }
});

    return router;
};

