const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const authenticateChairman = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        if (user.role !== 'chairman' && user.role !== 'specialist') {
            return res.status(403).json({ error: 'Недостаточно прав' });
        }
        req.user = user;
        next();
    });
};

module.exports = (app) => {
    const db = app.get('db');

    // Значения баллов
    const SCALE_VALUES = {
        'institute': 1,
        'university': 2,
        'city': 3,
        'regional': 4,
        'district': 5,
        'federal': 6
    };

    const ROLE_VALUES = {
        'volunteer': 1,
        'media': 2,
        'organizer': 3
    };

async function sendNotificationToSpecialists(title, message, eventId) {
        try {
            console.log(`📧 Отправка уведомления специалистам: ${title}`);
            
            // Получаем всех специалистов
            const [specialists] = await db.execute(
                'SELECT id FROM users WHERE role = "specialist"'
            );

            if (specialists.length === 0) {
                console.log('⚠️ Специалисты не найдены');
                return;
            }

            for (const spec of specialists) {
                await db.execute(
                    `INSERT INTO notifications (user_id, title, message, type, related_id, created_at) 
                     VALUES (?, ?, ?, 'info', ?, NOW())`,
                    [spec.id, title, message, eventId]
                );
            }
            
            console.log(`✅ Уведомления отправлены ${specialists.length} специалистам`);
            
        } catch (error) {
            console.error('❌ Ошибка при отправке уведомлений специалистам:', error);
        }
    }

    // Функция пересчета рейтинга
    async function recalculateUserRating(userId) {
    console.log('🔄 Пересчет рейтинга для пользователя:', userId);
    
    const connection = await db.getConnection();
    
    try {
        // Получаем сумму баллов с мероприятий (масштаб + роль)
        const [eventPoints] = await connection.execute(
            `SELECT COALESCE(SUM(ep.points_earned), 0) as total 
             FROM event_participations ep
             JOIN events e ON ep.event_id = e.id
             WHERE ep.user_id = ? AND e.status = 'approved'`,
            [userId]
        );

        // Получаем сумму баллов с достижений
        const [achievementPoints] = await connection.execute(
            `SELECT COALESCE(SUM(points), 0) as total 
             FROM achievements 
             WHERE user_id = ? AND status = 'approved'`,
            [userId]
        );

        // Получаем сумму штрафов (они уже хранятся как отрицательные числа)
        const [penaltyPoints] = await connection.execute(
            `SELECT COALESCE(SUM(points), 0) as total 
             FROM penalties 
             WHERE user_id = ?`,
            [userId]
        );

        // Итоговый рейтинг: мероприятия + достижения + штрафы (отрицательные)
        const totalRating = eventPoints[0].total + achievementPoints[0].total + penaltyPoints[0].total;

        console.log(`📊 Расчет: мероприятия=${eventPoints[0].total}, достижения=${achievementPoints[0].total}, штрафы=${penaltyPoints[0].total}, итого=${totalRating}`);

        // Обновляем рейтинг
        await connection.execute(
            'UPDATE users SET total_rating = ? WHERE id = ?',
            [totalRating, userId]
        );

        console.log(`✅ Рейтинг пользователя ${userId} обновлен: ${totalRating}`);
        
        return totalRating;

    } catch (error) {
        console.error(`❌ Ошибка при пересчете рейтинга для пользователя ${userId}:`, error);
        throw error;
    } finally {
        connection.release();
    }
}

    // Создание мероприятия
    router.post('/event', authenticateChairman, async (req, res) => {
        const { title, description, event_date, scale, participants } = req.body;
        
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();

            const [eventResult] = await connection.execute(
                `INSERT INTO events (title, description, event_date, scale, scale_value, status, created_by) 
                 VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
                [title, description, event_date, scale, SCALE_VALUES[scale], req.user.userId]
            );

            const eventId = eventResult.insertId;

            for (const participant of participants) {
                const points = SCALE_VALUES[scale] + ROLE_VALUES[participant.role];
                
                await connection.execute(
                    `INSERT INTO event_participations (user_id, event_id, role, role_value, points_earned) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [participant.userId, eventId, participant.role, ROLE_VALUES[participant.role], points]
                );
            }

            await connection.commit();
            
            res.status(201).json({ 
                message: 'Мероприятие создано и отправлено на модерацию', 
                eventId 
            });

        } catch (error) {
            await connection.rollback();
            console.error(error);
            res.status(500).json({ error: 'Ошибка при создании мероприятия' });
        } finally {
            connection.release();
        }
    });

    // Создание достижения
    router.post('/achievement', authenticateChairman, async (req, res) => {
        const { user_id, title, description, points } = req.body;

        try {
            const [result] = await db.execute(
                `INSERT INTO achievements (user_id, title, description, points, status, created_by) 
                 VALUES (?, ?, ?, ?, 'pending', ?)`,
                [user_id, title, description, points, req.user.userId]
            );

            res.status(201).json({ 
                message: 'Достижение создано и отправлено на модерацию', 
                achievementId: result.insertId 
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при создании достижения' });
        }
    });

// Повторная отправка мероприятия на модерацию
router.put('/event/:eventId/resubmit', authenticateChairman, async (req, res) => {
    console.log('📝 Получен запрос на повторную модерацию:', req.params.eventId);
    console.log('Тело запроса:', req.body);
    
    const { title, description, event_date, scale, participants } = req.body;
    
    // Валидация
    if (!title || !description || !event_date || !scale || !participants) {
        console.log('❌ Отсутствуют обязательные поля');
        return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }
    
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        // Проверяем, что мероприятие принадлежит этому председателю
        const [event] = await connection.execute(
            'SELECT id, status FROM events WHERE id = ? AND created_by = ?',
            [req.params.eventId, req.user.userId]
        );

        if (event.length === 0) {
            await connection.rollback();
            return res.status(403).json({ error: 'Нет прав на редактирование' });
        }

        console.log('✅ Мероприятие найдено, текущий статус:', event[0].status);

        // Обновляем основную информацию
        await connection.execute(
            `UPDATE events 
             SET title = ?, description = ?, event_date = ?, scale = ?, scale_value = ?, 
                 status = 'pending', moderated_by = NULL, moderated_at = NULL, rejection_reason = NULL
             WHERE id = ?`,
            [title, description, event_date, scale, SCALE_VALUES[scale], req.params.eventId]
        );

        console.log('✅ Основная информация обновлена');

        // Удаляем старых участников
        await connection.execute(
            'DELETE FROM event_participations WHERE event_id = ?',
            [req.params.eventId]
        );

        console.log('✅ Старые участники удалены');

        // Добавляем новых участников
        for (const participant of participants) {
            const points = SCALE_VALUES[scale] + ROLE_VALUES[participant.role];
            
            await connection.execute(
                `INSERT INTO event_participations (user_id, event_id, role, role_value, points_earned) 
                 VALUES (?, ?, ?, ?, ?)`,
                [participant.userId, req.params.eventId, participant.role, ROLE_VALUES[participant.role], points]
            );
            console.log(`✅ Участник ${participant.userId} добавлен с ролью ${participant.role}`);
        }

        await connection.commit();
        console.log('✅ Транзакция завершена успешно');

        // Отправляем уведомление специалистам
        await sendNotificationToSpecialists(
            `Мероприятие "${title}" отправлено на повторную модерацию`,
            `Председатель исправил замечания и отправил мероприятие на повторную проверку.`,
            req.params.eventId
        );

        res.json({ 
            success: true,
            message: 'Мероприятие обновлено и отправлено на повторную модерацию',
            eventId: req.params.eventId
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Ошибка при обновлении мероприятия:', error);
        res.status(500).json({ error: 'Ошибка при обновлении мероприятия: ' + error.message });
    } finally {
        connection.release();
    }
});

    // Получение списка участников команды
    router.get('/team-members', authenticateChairman, async (req, res) => {
        try {
            const [chairman] = await db.execute(
                'SELECT team_id FROM users WHERE id = ?',
                [req.user.userId]
            );

            if (!chairman[0] || !chairman[0].team_id) {
                return res.json([]);
            }

            const [members] = await db.execute(
                `SELECT id, full_name, username, total_rating, role 
                 FROM users 
                 WHERE team_id = ? AND role IN ('activist', 'chairman')
                 ORDER BY 
                    CASE WHEN role = 'chairman' THEN 0 ELSE 1 END,
                    total_rating DESC`,
                [chairman[0].team_id]
            );

            res.json(members);

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении списка команды' });
        }
    });

    // Получение данных мероприятия для редактирования
router.get('/event/:eventId', authenticateChairman, async (req, res) => {
    try {
        console.log('📋 Запрос данных мероприятия ID:', req.params.eventId);
        
        const [events] = await db.execute(
            `SELECT e.*, 
                    creator.full_name as creator_name,
                    moderator.full_name as moderator_name,
                    t.name as team_name
             FROM events e
             JOIN users creator ON e.created_by = creator.id
             LEFT JOIN users moderator ON e.moderated_by = moderator.id
             LEFT JOIN teams t ON creator.team_id = t.id
             WHERE e.id = ? AND e.created_by = ?`,
            [req.params.eventId, req.user.userId]
        );

        if (events.length === 0) {
            console.log('❌ Мероприятие не найдено или нет прав');
            return res.status(404).json({ error: 'Мероприятие не найдено' });
        }

        console.log('✅ Данные мероприятия загружены');
        console.log('Причина отказа:', events[0].rejection_reason); // Для отладки
        
        res.json(events[0]);
        
    } catch (error) {
        console.error('❌ Ошибка при получении данных:', error);
        res.status(500).json({ error: 'Ошибка при получении данных' });
    }
});

    // Получение всех пользователей для поиска
    router.get('/all-users', authenticateChairman, async (req, res) => {
        try {
            const [users] = await db.execute(
                `SELECT u.id, u.full_name, u.username, u.email, u.role, u.total_rating, 
                        t.name as team_name
                 FROM users u
                 LEFT JOIN teams t ON u.team_id = t.id
                 WHERE u.role IN ('activist', 'chairman')
                 ORDER BY u.full_name ASC`
            );
            
            res.json(users);

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении списка пользователей' });
        }
    });

    // Получение мероприятий председателя
    router.get('/my-events', authenticateChairman, async (req, res) => {
        try {
            const [events] = await db.execute(
                `SELECT e.*, 
                    COUNT(ep.id) as participants_count,
                    u.full_name as moderator_name
                FROM events e
                LEFT JOIN event_participations ep ON e.id = ep.event_id
                LEFT JOIN users u ON e.moderated_by = u.id
                WHERE e.created_by = ?
                GROUP BY e.id
                ORDER BY e.created_at DESC`,
                [req.user.userId]
            );

            res.json(events);

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении мероприятий' });
        }
    });

    // Получение статистики команды
    router.get('/team-stats', authenticateChairman, async (req, res) => {
        try {
            const [chairman] = await db.execute(
                'SELECT team_id FROM users WHERE id = ?',
                [req.user.userId]
            );

            if (!chairman[0] || !chairman[0].team_id) {
                return res.json({ totalMembers: 0, totalRating: 0, averageRating: 0, recentEvents: [] });
            }

            const [stats] = await db.execute(
                `SELECT 
                    COUNT(*) as total_members,
                    SUM(total_rating) as total_rating,
                    AVG(total_rating) as average_rating
                FROM users 
                WHERE team_id = ? AND role IN ('activist', 'chairman')`,
                [chairman[0].team_id]
            );

            const [recentEvents] = await db.execute(
                `SELECT e.title, e.event_date, e.status, COUNT(ep.id) as participants
                FROM events e
                JOIN event_participations ep ON e.id = ep.event_id
                JOIN users u ON ep.user_id = u.id
                WHERE u.team_id = ? AND e.status = 'approved'
                GROUP BY e.id
                ORDER BY e.event_date DESC
                LIMIT 5`,
                [chairman[0].team_id]
            );

            res.json({
                ...stats[0],
                recentEvents
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении статистики' });
        }
    });

    return router;
};