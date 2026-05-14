const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Middleware для проверки токена (для уведомлений)
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
};

// Middleware для проверки прав специалиста
const authenticateSpecialist = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        if (user.role !== 'specialist') {
            return res.status(403).json({ error: 'Требуются права специалиста' });
        }
        req.user = user;
        next();
    });
};

module.exports = (app) => {
    const db = app.get('db');
    console.log('✅ specialist.js инициализирован');

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

    // Функция пересчета рейтинга
    async function recalculateUserRating(userId) {
        console.log('🔄 Пересчет рейтинга для пользователя:', userId);
        
        const connection = await db.getConnection();
        
        try {
            const [eventPoints] = await connection.execute(
                `SELECT COALESCE(SUM(ep.points_earned), 0) as total 
                 FROM event_participations ep
                 JOIN events e ON ep.event_id = e.id
                 WHERE ep.user_id = ? AND e.status = 'approved'`,
                [userId]
            );

            const [achievementPoints] = await connection.execute(
                `SELECT COALESCE(SUM(points), 0) as total 
                 FROM achievements 
                 WHERE user_id = ? AND status = 'approved'`,
                [userId]
            );

            const [penaltyPoints] = await connection.execute(
                `SELECT COALESCE(SUM(points), 0) as total 
                 FROM penalties 
                 WHERE user_id = ?`,
                [userId]
            );

            const eventsTotal = Math.round(eventPoints[0].total || 0);
            const achievementsTotal = Math.round(achievementPoints[0].total || 0);
            const penaltiesTotal = Math.round(penaltyPoints[0].total || 0);
            const totalRating = eventsTotal + achievementsTotal + penaltiesTotal;

            await connection.execute(
                'UPDATE users SET total_rating = ? WHERE id = ?',
                [totalRating, userId]
            );

            console.log(`✅ Рейтинг пользователя ${userId} обновлен: ${totalRating}`);
            return totalRating;

        } catch (error) {
            console.error(`❌ Ошибка при пересчете рейтинга:`, error);
            throw error;
        } finally {
            connection.release();
        }
    }

    // ==================== ТЕСТОВЫЙ МАРШРУТ ====================
    router.get('/ping', (req, res) => {
        res.json({ message: 'pong', timestamp: new Date() });
    });

    // ==================== ПРИГЛАШЕНИЯ ====================
    router.post('/invite', authenticateSpecialist, async (req, res) => {
        console.log('\n📝 МАРШРУТ /specialist/invite СРАБОТАЛ!');
        console.log('Тело запроса:', req.body);
        
        try {
            const { vk_id, full_name, role, team_id } = req.body;
            
            if (!vk_id || !full_name || !role || !team_id) {
                return res.status(400).json({ error: 'Все поля обязательны' });
            }
            
            const normalizedVkId = vk_id.replace('@', '');
            
            const [existing] = await db.execute(
                'SELECT id FROM users WHERE vk_id = ?',
                [normalizedVkId]
            );
            
            if (existing.length > 0) {
                return res.status(400).json({ error: 'Пользователь с таким VK ID уже зарегистрирован' });
            }
            
            const crypto = require('crypto');
            const token = crypto.randomBytes(32).toString('hex');
            
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);
            
            const [result] = await db.execute(
                `INSERT INTO invitations (vk_id, full_name, role, team_id, token, created_by, expires_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [normalizedVkId, full_name, role, team_id, token, req.user.userId, expiresAt]
            );
            
            const baseUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
            const registerLink = `${baseUrl}/complete-registration.html?token=${token}`;
            
            console.log('✅ Приглашение создано, ID:', result.insertId);
            console.log('🔗 Ссылка для регистрации:', registerLink);
            
            res.json({ 
                success: true,
                message: 'Приглашение успешно создано',
                inviteId: result.insertId,
                debug_link: registerLink
            });
            
        } catch (error) {
            console.error('❌ Ошибка:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ==================== МЕРОПРИЯТИЯ НА МОДЕРАЦИЮ ====================
    router.get('/pending-events', authenticateSpecialist, async (req, res) => {
        try {
            const [events] = await db.execute(
                `SELECT e.*, 
                    creator.full_name as creator_name,
                    creator.id as creator_id,
                    t.name as team_name,
                    COUNT(ep.id) as participants_count
                FROM events e
                JOIN users creator ON e.created_by = creator.id
                LEFT JOIN teams t ON creator.team_id = t.id
                LEFT JOIN event_participations ep ON e.id = ep.event_id
                WHERE e.status = 'pending'
                GROUP BY e.id
                ORDER BY e.created_at ASC`,
                []
            );
            res.json(events);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении мероприятий' });
        }
    });

    // ==================== ДОСТИЖЕНИЯ НА МОДЕРАЦИЮ ====================
    router.get('/pending-achievements', authenticateSpecialist, async (req, res) => {
        try {
            const [achievements] = await db.execute(
                `SELECT a.*, 
                    creator.id as creator_id,
                    creator.full_name as creator_name,
                    u.id as user_id,
                    u.full_name as user_name,
                    t.name as team_name
                FROM achievements a
                JOIN users creator ON a.created_by = creator.id
                JOIN users u ON a.user_id = u.id
                LEFT JOIN teams t ON u.team_id = t.id
                WHERE a.status = 'pending'
                ORDER BY a.created_at ASC`,
                []
            );
            res.json(achievements);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении достижений' });
        }
    });

    // ==================== МОДЕРАЦИЯ МЕРОПРИЯТИЯ ====================
    router.post('/moderate-event/:eventId', authenticateSpecialist, async (req, res) => {
        const { status, reason } = req.body;
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [participants] = await connection.execute(
                'SELECT user_id FROM event_participations WHERE event_id = ?',
                [req.params.eventId]
            );

            if (status === 'rejected') {
                await connection.execute(
                    `UPDATE events 
                     SET status = ?, moderated_by = ?, moderated_at = NOW(), rejection_reason = ? 
                     WHERE id = ?`,
                    [status, req.user.userId, reason || 'Причина не указана', req.params.eventId]
                );
            } else {
                await connection.execute(
                    `UPDATE events 
                     SET status = ?, moderated_by = ?, moderated_at = NOW(), rejection_reason = NULL 
                     WHERE id = ?`,
                    [status, req.user.userId, req.params.eventId]
                );
            }

            await connection.commit();

            if (status === 'approved') {
                for (const participant of participants) {
                    await recalculateUserRating(participant.user_id);
                }
            }

            res.json({ 
                message: status === 'approved' ? 'Мероприятие принято' : 'Мероприятие отклонено',
                status 
            });

        } catch (error) {
            await connection.rollback();
            console.error(error);
            res.status(500).json({ error: 'Ошибка при модерации мероприятия' });
        } finally {
            connection.release();
        }
    });

    // ==================== МОДЕРАЦИЯ ДОСТИЖЕНИЯ ====================
    router.post('/moderate-achievement/:achievementId', authenticateSpecialist, async (req, res) => {
        const { status, reason } = req.body;
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [achievement] = await connection.execute(
                'SELECT user_id FROM achievements WHERE id = ?',
                [req.params.achievementId]
            );

            if (status === 'rejected') {
                await connection.execute(
                    `UPDATE achievements 
                     SET status = ?, moderated_by = ?, moderated_at = NOW(), rejection_reason = ? 
                     WHERE id = ?`,
                    [status, req.user.userId, reason || 'Причина не указана', req.params.achievementId]
                );
            } else {
                await connection.execute(
                    `UPDATE achievements 
                     SET status = ?, moderated_by = ?, moderated_at = NOW(), rejection_reason = NULL 
                     WHERE id = ?`,
                    [status, req.user.userId, req.params.achievementId]
                );
            }

            await connection.commit();

            if (status === 'approved') {
                await recalculateUserRating(achievement[0].user_id);
            }

            res.json({ 
                message: status === 'approved' ? 'Достижение принято' : 'Достижение отклонено',
                status 
            });

        } catch (error) {
            await connection.rollback();
            console.error(error);
            res.status(500).json({ error: 'Ошибка при модерации достижения' });
        } finally {
            connection.release();
        }
    });

    // ==================== ВСЕ МЕРОПРИЯТИЯ ====================
    router.get('/all-events', authenticateSpecialist, async (req, res) => {
        try {
            const [events] = await db.execute(
                `SELECT e.*, 
                    creator.full_name as creator_name,
                    creator.id as creator_id,
                    t.name as team_name,
                    COUNT(ep.id) as participants_count
                FROM events e
                JOIN users creator ON e.created_by = creator.id
                LEFT JOIN teams t ON creator.team_id = t.id
                LEFT JOIN event_participations ep ON e.id = ep.event_id
                GROUP BY e.id
                ORDER BY e.created_at DESC`,
                []
            );
            res.json(events);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении мероприятий' });
        }
    });

    // ==================== СОЗДАНИЕ МЕРОПРИЯТИЯ ====================
    router.post('/event', authenticateSpecialist, async (req, res) => {
        const { title, description, event_date, scale, participants } = req.body;
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();

            const [eventResult] = await connection.execute(
                `INSERT INTO events (title, description, event_date, scale, scale_value, status, created_by, moderated_by, moderated_at) 
                 VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, NOW())`,
                [title, description, event_date, scale, SCALE_VALUES[scale], req.user.userId, req.user.userId]
            );

            const eventId = eventResult.insertId;

            for (const participant of participants) {
                const totalPoints = SCALE_VALUES[scale] + ROLE_VALUES[participant.role];
                await connection.execute(
                    `INSERT INTO event_participations (user_id, event_id, role, role_value, points_earned) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [participant.userId, eventId, participant.role, ROLE_VALUES[participant.role], totalPoints]
                );
            }

            await connection.commit();
            
            for (const participant of participants) {
                await recalculateUserRating(participant.userId);
            }
            
            res.status(201).json({ message: 'Мероприятие успешно создано', eventId });

        } catch (error) {
            await connection.rollback();
            console.error(error);
            res.status(500).json({ error: 'Ошибка при создании мероприятия' });
        } finally {
            connection.release();
        }
    });

    // ==================== ШТРАФЫ ====================
    router.post('/penalty', authenticateSpecialist, async (req, res) => {
    const { user_id, points, reason } = req.body;
    
    console.log(`📝 Выписка штрафа пользователю ${user_id} на ${points} баллов`);
    console.log(`Причина: ${reason}`);
    
    const connection = await db.getConnection();
    
    try {
        // Получаем информацию о пользователе, которому выписывают штраф
        const [user] = await connection.execute(
            'SELECT full_name, vk_id FROM users WHERE id = ?',
            [user_id]
        );
        
        // Получаем информацию о специалисте, который выписывает штраф
        const [specialist] = await connection.execute(
            'SELECT full_name FROM users WHERE id = ?',
            [req.user.userId]
        );
        
        if (user.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Получаем текущий рейтинг ДО штрафа
        const [currentUser] = await connection.execute(
            'SELECT total_rating FROM users WHERE id = ?',
            [user_id]
        );
        const oldRating = currentUser[0].total_rating;
        console.log(`   Текущий рейтинг: ${oldRating}`);

        await connection.beginTransaction();

        // Сохраняем штраф как отрицательное число
        const penaltyPoints = -Math.abs(parseInt(points));
        
        const [penaltyResult] = await connection.execute(
            `INSERT INTO penalties (user_id, issued_by, points, reason) 
             VALUES (?, ?, ?, ?)`,
            [user_id, req.user.userId, penaltyPoints, reason]
        );

        console.log('✅ Штраф создан, ID:', penaltyResult.insertId, 'баллы:', penaltyPoints);
        
        await connection.commit();

        // Пересчитываем рейтинг ПОСЛЕ штрафа
        const newRating = await recalculateUserRating(user_id);
        
        console.log(`   Рейтинг ДО: ${oldRating}, ПОСЛЕ: ${newRating}, Изменение: ${newRating - oldRating}`);

        // Отправляем уведомление в VK
const { sendPenaltyNotification } = require('../utils/vk-bot');
const vkId = user[0].vk_id;

if (vkId) {
    await sendPenaltyNotification(vkId, {
        specialistName: specialist[0].full_name,
        points: points,
        reason: reason,
        oldRating: oldRating,
        newRating: newRating
    });
}

        res.json({ 
            message: 'Штраф успешно выписан',
            oldRating: oldRating,
            newRating: newRating,
            change: newRating - oldRating
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Ошибка при создании штрафа:', error);
        res.status(500).json({ error: 'Ошибка при создании штрафа: ' + error.message });
    } finally {
        connection.release();
    }
});

    // ==================== ИЗМЕНЕНИЕ РОЛИ ====================
    router.put('/user/:userId/role', authenticateSpecialist, async (req, res) => {
        const { role } = req.body;
        try {
            await db.execute('UPDATE users SET role = ? WHERE id = ?', [role, req.params.userId]);
            res.json({ message: 'Роль пользователя успешно изменена' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при изменении роли' });
        }
    });

    // ==================== УДАЛЕНИЕ ПОЛЬЗОВАТЕЛЯ ====================
    router.delete('/user/:userId', authenticateSpecialist, async (req, res) => {
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();

            const [user] = await connection.execute('SELECT id FROM users WHERE id = ?', [req.params.userId]);
            if (user.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
            if (user[0].id === req.user.userId) return res.status(400).json({ error: 'Нельзя удалить самого себя' });

            await connection.execute('DELETE FROM penalties WHERE user_id = ?', [req.params.userId]);
            await connection.execute('DELETE FROM event_participations WHERE user_id = ?', [req.params.userId]);
            await connection.execute('DELETE FROM achievements WHERE user_id = ?', [req.params.userId]);
            await connection.execute('UPDATE events SET created_by = NULL WHERE created_by = ?', [req.params.userId]);
            await connection.execute('UPDATE events SET moderated_by = NULL WHERE moderated_by = ?', [req.params.userId]);
            await connection.execute('UPDATE achievements SET created_by = NULL WHERE created_by = ?', [req.params.userId]);
            await connection.execute('UPDATE achievements SET moderated_by = NULL WHERE moderated_by = ?', [req.params.userId]);
            await connection.execute('UPDATE penalties SET issued_by = NULL WHERE issued_by = ?', [req.params.userId]);

            await connection.execute('DELETE FROM users WHERE id = ?', [req.params.userId]);
            await connection.commit();

            res.json({ message: 'Пользователь успешно удален', deletedId: req.params.userId });
        } catch (error) {
            await connection.rollback();
            console.error(error);
            res.status(500).json({ error: 'Ошибка при удалении пользователя' });
        } finally {
            connection.release();
        }
    });

    // ==================== ПОЛЬЗОВАТЕЛИ ====================
    router.get('/users', authenticateSpecialist, async (req, res) => {
        try {
            const [users] = await db.execute(
                `SELECT u.id, u.username, u.vk_id, u.full_name, u.role, u.total_rating, 
                        t.name as team_name, u.created_at
                 FROM users u
                 LEFT JOIN teams t ON u.team_id = t.id
                 ORDER BY u.created_at DESC`,
                []
            );
            users.forEach(user => delete user.password_hash);
            res.json(users);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении пользователей' });
        }
    });

    router.get('/all-users', authenticateSpecialist, async (req, res) => {
        try {
            const [users] = await db.execute(
                `SELECT u.id, u.full_name, u.username, u.vk_id, u.role, u.total_rating, 
                        t.name as team_name
                 FROM users u
                 LEFT JOIN teams t ON u.team_id = t.id
                 WHERE u.role IN ('activist', 'chairman', 'specialist')
                 ORDER BY u.full_name ASC`
            );
            res.json(users);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении списка пользователей' });
        }
    });

    // ==================== КОМАНДЫ ====================
    router.post('/team', authenticateSpecialist, async (req, res) => {
        const { name } = req.body;
        try {
            const [result] = await db.execute('INSERT INTO teams (name) VALUES (?)', [name]);
            res.status(201).json({ message: 'Команда успешно создана', teamId: result.insertId });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при создании команды' });
        }
    });

    // ==================== СТАТИСТИКА ====================
    router.get('/system-stats', authenticateSpecialist, async (req, res) => {
        try {
            const [totalUsers] = await db.execute('SELECT COUNT(*) as count FROM users');
            const [totalEvents] = await db.execute('SELECT COUNT(*) as count FROM events WHERE status = "approved"');
            const [pendingEvents] = await db.execute('SELECT COUNT(*) as count FROM events WHERE status = "pending"');
            const [pendingAchievements] = await db.execute('SELECT COUNT(*) as count FROM achievements WHERE status = "pending"');
            
            const [topActivists] = await db.execute(
                `SELECT u.id, u.full_name, u.total_rating, t.name as team_name 
                 FROM users u
                 LEFT JOIN teams t ON u.team_id = t.id
                 WHERE u.role IN ('activist', 'chairman')
                 ORDER BY total_rating DESC 
                 LIMIT 5`
            );

            res.json({
                totalUsers: totalUsers[0].count,
                totalEvents: totalEvents[0].count,
                pendingEvents: pendingEvents[0].count,
                pendingAchievements: pendingAchievements[0].count,
                topActivists
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении статистики' });
        }
    });

    // ==================== ДЕТАЛИ МЕРОПРИЯТИЯ ====================
    router.get('/event/:eventId', authenticateSpecialist, async (req, res) => {
        try {
            const [events] = await db.execute(
                `SELECT e.*, 
                    creator.full_name as creator_name,
                    moderator.full_name as moderator_name
                 FROM events e
                 JOIN users creator ON e.created_by = creator.id
                 LEFT JOIN users moderator ON e.moderated_by = moderator.id
                 WHERE e.id = ?`,
                [req.params.eventId]
            );
            if (events.length === 0) return res.status(404).json({ error: 'Мероприятие не найдено' });
            res.json(events[0]);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении данных мероприятия' });
        }
    });

    router.get('/event/:eventId/participants', authenticateSpecialist, async (req, res) => {
        try {
            const [participants] = await db.execute(
                `SELECT ep.*, u.full_name, t.name as team_name
                 FROM event_participations ep
                 JOIN users u ON ep.user_id = u.id
                 LEFT JOIN teams t ON u.team_id = t.id
                 WHERE ep.event_id = ?
                 ORDER BY u.full_name`,
                [req.params.eventId]
            );
            res.json(participants);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении участников' });
        }
    });

    // ==================== УВЕДОМЛЕНИЯ ====================
    router.get('/notifications', authenticateToken, async (req, res) => {
        try {
            const [notifications] = await db.execute(
                `SELECT * FROM notifications 
                 WHERE user_id = ? 
                 ORDER BY created_at DESC 
                 LIMIT 50`,
                [req.user.userId]
            );
            res.json(notifications);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при получении уведомлений' });
        }
    });

    router.put('/notifications/:id/read', authenticateToken, async (req, res) => {
        try {
            await db.execute(
                'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
                [req.params.id, req.user.userId]
            );
            res.json({ message: 'Уведомление отмечено как прочитанное' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при обновлении уведомления' });
        }
    });

    router.post('/user', authenticateSpecialist, async (req, res) => {
    console.log('📝 Создание пользователя специалистом');
    console.log('Тело запроса:', { ...req.body, password: '***' });
    
    const { username, vk_id, password, full_name, role, team_id } = req.body;
    
    // Валидация
    if (!username || !vk_id || !password || !full_name || !role || !team_id) {
        return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }
    
    try {
        // Проверяем существование пользователя
        const [existing] = await db.execute(
            'SELECT id FROM users WHERE username = ? OR vk_id = ?',
            [username, vk_id]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Пользователь с таким логином или VK ID уже существует' });
        }
        
        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создаем пользователя
        const [result] = await db.execute(
            `INSERT INTO users (username, vk_id, password_hash, full_name, role, team_id) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [username, vk_id, hashedPassword, full_name, role, team_id]
        );
        
        console.log('✅ Пользователь создан, ID:', result.insertId);
        
        res.status(201).json({ 
            message: 'Пользователь успешно создан', 
            userId: result.insertId 
        });
        
    } catch (error) {
        console.error('❌ Ошибка при создании пользователя:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }
});

    router.get('/notifications/unread/count', authenticateToken, async (req, res) => {
        try {
            const [result] = await db.execute(
                'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
                [req.user.userId]
            );
            res.json({ count: result[0].count });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при подсчете уведомлений' });
        }
    });

    router.put('/notifications/read-all', authenticateToken, async (req, res) => {
        try {
            await db.execute(
                'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
                [req.user.userId]
            );
            res.json({ message: 'Все уведомления отмечены как прочитанные' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при обновлении уведомлений' });
        }
    });

    router.post('/send-notifications', authenticateSpecialist, async (req, res) => {
        const { eventId, status, reason, participants, creatorId } = req.body;
        
        try {
            const [event] = await db.execute('SELECT title FROM events WHERE id = ?', [eventId]);
            if (event.length === 0) return res.status(404).json({ error: 'Мероприятие не найдено' });

            const notifications = [];
            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            
            notifications.push([
                creatorId,
                `Мероприятие "${event[0].title}" ${status === 'approved' ? 'принято' : 'отклонено'}`,
                status === 'approved' 
                    ? 'Ваше мероприятие прошло модерацию и баллы начислены участникам.'
                    : `Ваше мероприятие отклонено. Причина: ${reason || 'Не указана'}.`,
                status,
                eventId,
                now
            ]);
            
            if (status === 'rejected') {
                for (const userId of participants) {
                    if (userId !== creatorId) {
                        notifications.push([
                            userId,
                            `Мероприятие "${event[0].title}" отклонено`,
                            `Мероприятие, в котором вы участвовали, отклонено модератором. Причина: ${reason || 'Не указана'}.`,
                            status,
                            eventId,
                            now
                        ]);
                    }
                }
            }

            for (const notif of notifications) {
                await db.execute(
                    `INSERT INTO notifications (user_id, title, message, type, related_id, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    notif
                );
            }

            res.json({ message: 'Уведомления отправлены', count: notifications.length });
        } catch (error) {
            console.error('Ошибка при отправке уведомлений:', error);
            res.status(500).json({ error: 'Ошибка при отправке уведомлений' });
        }
    });

    return router;
};