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



    return router;
};