const express = require('express');
const router = express.Router();
const db = require('../db'); // предполагаем, что у вас есть модуль БД

// Middleware для проверки аутентификации
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }
    res.status(401).json({ error: 'Не авторизован' });
};

// Получение всех мероприятий для календаря
router.get('/api/events', isAuthenticated, async (req, res) => {
    try {
        const { scale, team, start, end } = req.query;
        
        let query = `
            SELECT 
                e.*,
                u.full_name as created_by_name,
                t.name as team_name,
                COUNT(DISTINCT ep.id) as participants_count
            FROM events e
            LEFT JOIN users u ON e.created_by = u.id
            LEFT JOIN teams t ON u.team_id = t.id
            LEFT JOIN event_participations ep ON e.id = ep.event_id 
                AND ep.status IN ('registered', 'confirmed', 'attended')
            WHERE e.status = 'approved' 
                AND e.is_public = true
        `;
        
        const queryParams = [];
        
        // Фильтр по датам для календаря
        if (start && end) {
            query += ` AND e.event_date BETWEEN ? AND ?`;
            queryParams.push(start, end);
        }
        
        // Фильтр по масштабу
        if (scale && scale !== 'all') {
            query += ` AND e.scale = ?`;
            queryParams.push(scale);
        }
        
        // Фильтр по команде
        if (team && team !== 'all') {
            query += ` AND u.team_id = ?`;
            queryParams.push(team);
        }
        
        query += ` GROUP BY e.id ORDER BY e.event_date ASC`;
        
        const [events] = await db.execute(query, queryParams);
        
        // Преобразуем в формат для FullCalendar
        const calendarEvents = events.map(event => ({
            id: event.id.toString(),
            title: event.title,
            start: event.event_date,
            end: event.end_date || event.event_date,
            allDay: true,
            backgroundColor: getEventColor(event.scale),
            borderColor: 'transparent',
            textColor: '#ffffff',
            extendedProps: {
                description: event.description,
                scale: event.scale,
                scale_value: event.scale_value,
                location: event.location,
                participants: event.participants_count,
                max_participants: event.max_participants,
                organizer: event.created_by_name,
                team: event.team_name
            }
        }));
        
        res.json(calendarEvents);
        
    } catch (error) {
        console.error('Ошибка получения событий:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение деталей конкретного мероприятия
router.get('/api/events/:id', isAuthenticated, async (req, res) => {
    try {
        const [events] = await db.execute(`
            SELECT 
                e.*,
                u.full_name as created_by_name,
                u.team_id,
                t.name as team_name,
                COUNT(DISTINCT ep.id) as participants_count,
                GROUP_CONCAT(DISTINCT CONCAT(ep_u.full_name, ' (', ep.role, ')') SEPARATOR '||') as participants_list
            FROM events e
            LEFT JOIN users u ON e.created_by = u.id
            LEFT JOIN teams t ON u.team_id = t.id
            LEFT JOIN event_participations ep ON e.id = ep.event_id 
                AND ep.status IN ('registered', 'confirmed', 'attended')
            LEFT JOIN users ep_u ON ep.user_id = ep_u.id
            WHERE e.id = ?
            GROUP BY e.id
        `, [req.params.id]);
        
        if (events.length === 0) {
            return res.status(404).json({ error: 'Мероприятие не найдено' });
        }
        
        const event = events[0];
        
        // Парсим список участников
        if (event.participants_list) {
            event.participants = event.participants_list.split('||').map(p => {
                const [name, role] = p.split(' (');
                return {
                    name,
                    role: role ? role.slice(0, -1) : 'volunteer'
                };
            });
        } else {
            event.participants = [];
        }
        
        delete event.participants_list;
        
        // Проверяем, зарегистрирован ли текущий пользователь
        if (req.session.userId) {
            const [registration] = await db.execute(
                'SELECT * FROM event_participations WHERE event_id = ? AND user_id = ?',
                [req.params.id, req.session.userId]
            );
            event.user_registered = registration.length > 0;
            event.user_registration_status = registration[0]?.status || null;
        }
        
        res.json(event);
        
    } catch (error) {
        console.error('Ошибка получения деталей события:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Регистрация на мероприятие
router.post('/api/events/:id/register', isAuthenticated, async (req, res) => {
    try {
        const { role = 'volunteer' } = req.body;
        const eventId = req.params.id;
        const userId = req.session.userId;
        
        // Проверяем, существует ли мероприятие
        const [events] = await db.execute(
            'SELECT * FROM events WHERE id = ? AND status = "approved"',
            [eventId]
        );
        
        if (events.length === 0) {
            return res.status(404).json({ error: 'Мероприятие не найдено' });
        }
        
        const event = events[0];
        
        // Проверяем, не истекла ли дата
        if (new Date(event.event_date) < new Date()) {
            return res.status(400).json({ error: 'Мероприятие уже прошло' });
        }
        
        // Проверяем, не зарегистрирован ли уже пользователь
        const [existing] = await db.execute(
            'SELECT * FROM event_participations WHERE event_id = ? AND user_id = ?',
            [eventId, userId]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Вы уже зарегистрированы на это мероприятие' });
        }
        
        // Проверяем лимит участников
        if (event.max_participants) {
            const [count] = await db.execute(
                'SELECT COUNT(*) as cnt FROM event_participations WHERE event_id = ? AND status IN ("registered", "confirmed")',
                [eventId]
            );
            
            if (count[0].cnt >= event.max_participants) {
                return res.status(400).json({ error: 'Достигнут лимит участников' });
            }
        }
        
        // Получаем значение роли из таблицы scales
        const [scaleValue] = await db.execute(
            'SELECT role_value FROM event_roles WHERE role = ?',
            [role]
        );
        
        const roleValue = scaleValue[0]?.role_value || 1;
        
        // Регистрируем пользователя
        await db.execute(
            `INSERT INTO event_participations 
            (user_id, event_id, role, role_value, status, registered_at) 
            VALUES (?, ?, ?, ?, 'registered', NOW())`,
            [userId, eventId, role, roleValue]
        );
        
        // Создаем уведомление
        await db.execute(
            `INSERT INTO notifications 
            (user_id, title, message, type, related_id) 
            VALUES (?, ?, ?, 'info', ?)`,
            [userId, 'Регистрация на мероприятие', 
             `Вы зарегистрированы на мероприятие "${event.title}"`, eventId]
        );
        
        res.json({ 
            success: true, 
            message: 'Вы успешно зарегистрированы на мероприятие' 
        });
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отмена регистрации
router.post('/api/events/:id/cancel', isAuthenticated, async (req, res) => {
    try {
        const eventId = req.params.id;
        const userId = req.session.userId;
        
        const [result] = await db.execute(
            'DELETE FROM event_participations WHERE event_id = ? AND user_id = ? AND status = "registered"',
            [eventId, userId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(400).json({ error: 'Не удалось отменить регистрацию' });
        }
        
        res.json({ success: true, message: 'Регистрация отменена' });
        
    } catch (error) {
        console.error('Ошибка отмены регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение списка команд для фильтра
router.get('/api/teams', isAuthenticated, async (req, res) => {
    try {
        const [teams] = await db.execute(
            'SELECT id, name FROM teams ORDER BY name'
        );
        res.json(teams);
    } catch (error) {
        console.error('Ошибка получения команд:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вспомогательная функция для цвета события
function getEventColor(scale) {
    const colors = {
        'institute': '#4CAF50',
        'university': '#2196F3',
        'city': '#FF9800',
        'regional': '#9C27B0',
        'district': '#F44336',
        'federal': '#E91E63'
    };
    return colors[scale] || '#3788d8';
}

module.exports = router;