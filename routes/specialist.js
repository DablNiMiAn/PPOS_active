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
// Middleware для проверки прав специалиста
const authenticateSpecialist = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        console.log('❌ Нет токена в cookies');
        return res.status(401).json({ error: 'Не авторизован' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('✅ Токен декодирован:', decoded);
        
        if (decoded.role !== 'specialist') {
            console.log(`❌ Недостаточно прав. Роль пользователя: ${decoded.role}, требуется: specialist`);
            return res.status(403).json({ error: 'Требуются права специалиста' });
        }
        
        req.user = decoded;
        console.log('✅ Пользователь авторизован как специалист:', decoded.userId);
        next();
    } catch (err) {
        console.log('❌ Ошибка верификации токена:', err.message);
        return res.status(403).json({ error: 'Недействительный токен' });
    }
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

    // Функция пересчета рейтинга пользователя
    async function recalculateUserRating(userId) {
    console.log('🔄 Пересчет рейтинга для пользователя:', userId);
    
    const connection = await db.getConnection();
    
    try {
        // 1. Получаем сумму баллов с мероприятий (масштаб + роль)
        const [eventPoints] = await connection.execute(
            `SELECT COALESCE(SUM(ep.points_earned), 0) as total 
             FROM event_participations ep
             JOIN events e ON ep.event_id = e.id
             WHERE ep.user_id = ? AND e.status = 'approved'`,
            [userId]
        );

        // 2. Получаем сумму баллов с достижений
        const [achievementPoints] = await connection.execute(
            `SELECT COALESCE(SUM(points), 0) as total 
             FROM achievements 
             WHERE user_id = ? AND status = 'approved'`,
            [userId]
        );

        // 3. Получаем сумму штрафов (отрицательные числа)
        const [penaltyPoints] = await connection.execute(
            `SELECT COALESCE(SUM(points), 0) as total 
             FROM penalties 
             WHERE user_id = ?`,
            [userId]
        );

        // 4. РАСЧЕТ: мероприятия + достижения + штрафы (штрафы уже отрицательные)
        const eventsTotal = Math.round(eventPoints[0].total || 0);
        const achievementsTotal = Math.round(achievementPoints[0].total || 0);
        const penaltiesTotal = Math.round(penaltyPoints[0].total || 0);
        
        // Это ключевая формула: все складываем (штрафы уже отрицательные)
        const totalRating = eventsTotal + achievementsTotal + penaltiesTotal;

        console.log(`📊 Детальный расчет для пользователя ${userId}:`);
        console.log(`   - Мероприятия: +${eventsTotal}`);
        console.log(`   - Достижения: +${achievementsTotal}`);
        console.log(`   - Штрафы: ${penaltiesTotal}`);
        console.log(`   = ИТОГО: ${totalRating}`);

        // 5. Обновляем рейтинг
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

    // Получение мероприятий на модерацию
    router.get('/pending-events', authenticateSpecialist, async (req, res) => {
        try {
            const [events] = await db.execute(
                `SELECT e.*, 
                    creator.full_name as creator_name,
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

    // Получение достижений на модерацию
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

    // Модерация мероприятия (принять/отклонить)
    router.post('/moderate-event/:eventId', authenticateSpecialist, async (req, res) => {
    const { status, reason } = req.body;
    console.log(`📝 Модерация мероприятия ${req.params.eventId}, статус: ${status}, причина: ${reason || 'не указана'}`);
    
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Получаем участников мероприятия
        const [participants] = await connection.execute(
            'SELECT user_id FROM event_participations WHERE event_id = ?',
            [req.params.eventId]
        );

        // Обновляем статус мероприятия и сохраняем причину отказа
        if (status === 'rejected') {
            await connection.execute(
                `UPDATE events 
                 SET status = ?, moderated_by = ?, moderated_at = NOW(), rejection_reason = ? 
                 WHERE id = ?`,
                [status, req.user.userId, reason || 'Причина не указана', req.params.eventId]
            );
            console.log('✅ Мероприятие отклонено, причина сохранена');
        } else {
            await connection.execute(
                `UPDATE events 
                 SET status = ?, moderated_by = ?, moderated_at = NOW(), rejection_reason = NULL 
                 WHERE id = ?`,
                [status, req.user.userId, req.params.eventId]
            );
            console.log('✅ Мероприятие принято');
        }

        await connection.commit();

        if (status === 'approved') {
            // Пересчитываем рейтинги участников
            for (const participant of participants) {
                try {
                    await recalculateUserRating(participant.user_id);
                } catch (ratingError) {
                    console.error(`Ошибка при пересчете рейтинга участника ${participant.user_id}:`, ratingError);
                }
            }
        }

// ==================== ПОИСК АКТИВИСТОВ ДЛЯ ДОСТИЖЕНИЙ ====================
let achievementSearchResults = [];
let selectedAchievementUserId = null;

function searchAchievementUsers() {
    const searchText = document.getElementById('achievementUserSearch').value.toLowerCase();
    
    if (searchText.length < 2) {
        document.getElementById('achievementUserResults').innerHTML = '<div style="padding: 10px; text-align: center; color: #666;">Введите минимум 2 символа</div>';
        document.getElementById('achievementSearchCount').textContent = '0';
        return;
    }
    
    fetch('/specialist/all-users')
        .then(res => res.json())
        .then(users => {
            // Фильтруем только активистов
            const activists = users.filter(user => user.role === 'activist');
            const filtered = activists.filter(user => 
                user.full_name.toLowerCase().includes(searchText)
            );
            
            document.getElementById('achievementSearchCount').textContent = filtered.length;
            displayAchievementSearchResults(filtered.slice(0, 10));
            achievementSearchResults = filtered;
        });
}

function displayAchievementSearchResults(users) {
    const container = document.getElementById('achievementUserResults');
    
    if (users.length === 0) {
        container.innerHTML = '<div style="padding: 10px; text-align: center; color: #666;">Активисты не найдены</div>';
        return;
    }
    
    container.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.style.cssText = 'padding: 10px; border-bottom: 1px solid #e0e0e0; cursor: pointer; display: flex; justify-content: space-between; align-items: center;';
        div.onclick = () => selectAchievementUser(user.id, user.full_name);
        div.innerHTML = `
            <div>
                <strong>${user.full_name}</strong>
                <div style="font-size: 0.85rem; color: #666;">${user.team_name || 'Без команды'} | Рейтинг: ${user.total_rating}</div>
            </div>
            <span style="color: #7AC7C4;">➕</span>
        `;
        container.appendChild(div);
    });
}

function selectAchievementUser(id, name) {
    selectedAchievementUserId = id;
    
    // Подсвечиваем выбранного
    document.querySelectorAll('#achievementUserResults .search-result-item').forEach(item => {
        item.style.background = 'white';
    });
    event.currentTarget.style.background = '#f0f0f0';
    
    // Обновляем селект
    const select = document.getElementById('achievementUserId');
    select.innerHTML = `<option value="${id}">${name}</option>`;
}

        res.json({ 
            message: status === 'approved' ? 'Мероприятие принято' : 'Мероприятие отклонено',
            status 
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Ошибка при модерации мероприятия:', error);
        res.status(500).json({ error: 'Ошибка при модерации мероприятия: ' + error.message });
    } finally {
        connection.release();
    }
});

    // Модерация достижения (принять/отклонить)
    router.post('/moderate-achievement/:achievementId', authenticateSpecialist, async (req, res) => {
        const { status } = req.body;
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [achievement] = await connection.execute(
                'SELECT user_id FROM achievements WHERE id = ?',
                [req.params.achievementId]
            );

            await connection.execute(
                `UPDATE achievements 
                 SET status = ?, moderated_by = ?, moderated_at = NOW() 
                 WHERE id = ?`,
                [status, req.user.userId, req.params.achievementId]
            );

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

    // Получение всех мероприятий
router.get('/all-events', authenticateSpecialist, async (req, res) => {
    try {
        console.log('📋 Запрос всех мероприятий');
        
        const [events] = await db.execute(
            `SELECT e.*, 
                    creator.full_name as creator_name,
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

        console.log(`✅ Загружено ${events.length} мероприятий`);
        res.json(events);
        
    } catch (error) {
        console.error('❌ Ошибка при получении мероприятий:', error);
        res.status(500).json({ error: 'Ошибка при получении мероприятий' });
    }
});

    // Создание мероприятия (специалист создает сразу approved)
    router.post('/event', authenticateSpecialist, async (req, res) => {
    const { title, description, event_date, scale, participants } = req.body;
    
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        // Создание мероприятия (сразу approved)
        const [eventResult] = await connection.execute(
            `INSERT INTO events (title, description, event_date, scale, scale_value, status, created_by, moderated_by, moderated_at) 
             VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, NOW())`,
            [title, description, event_date, scale, SCALE_VALUES[scale], req.user.userId, req.user.userId]
        );

        const eventId = eventResult.insertId;

        // Добавление участников
        for (const participant of participants) {
            // Правильный расчет: масштаб + роль
            const scalePoints = SCALE_VALUES[scale];
            const rolePoints = ROLE_VALUES[participant.role];
            const totalPoints = scalePoints + rolePoints;
            
            console.log(`📊 Участник ${participant.userId}: масштаб=${scalePoints}, роль=${rolePoints}, итого=${totalPoints}`);
            
            await connection.execute(
                `INSERT INTO event_participations (user_id, event_id, role, role_value, points_earned) 
                 VALUES (?, ?, ?, ?, ?)`,
                [participant.userId, eventId, participant.role, rolePoints, totalPoints]
            );
        }

        await connection.commit();
        console.log('✅ Транзакция создания мероприятия завершена успешно');
        
        // Обновляем рейтинги участников
        for (const participant of participants) {
            try {
                await recalculateUserRating(participant.userId);
            } catch (ratingError) {
                console.error(`❌ Ошибка при обновлении рейтинга участника ${participant.userId}:`, ratingError);
            }
        }
        
        res.status(201).json({ 
            message: 'Мероприятие успешно создано', 
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

    // Создание штрафа
    router.post('/penalty', authenticateSpecialist, async (req, res) => {
    const { user_id, points, reason } = req.body;
    
    console.log(`📝 Выписка штрафа пользователю ${user_id} на ${points} баллов`);
    
    const connection = await db.getConnection();
    
    try {
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

    // Создание пользователя
    router.post('/user', authenticateSpecialist, async (req, res) => {
        const { username, email, password, full_name, role, team_id } = req.body;

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
                `INSERT INTO users (username, email, password_hash, full_name, role, team_id) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [username, email, hashedPassword, full_name, role, team_id || null]
            );

            res.status(201).json({ 
                message: 'Пользователь успешно создан', 
                userId: result.insertId 
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при создании пользователя' });
        }
    });

    // Изменение роли пользователя
    router.put('/user/:userId/role', authenticateSpecialist, async (req, res) => {
        const { role } = req.body;

        try {
            await db.execute(
                'UPDATE users SET role = ? WHERE id = ?',
                [role, req.params.userId]
            );

            res.json({ message: 'Роль пользователя успешно изменена' });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при изменении роли' });
        }
    });

    // Удаление пользователя
    router.delete('/user/:userId', authenticateSpecialist, async (req, res) => {
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();

            const [user] = await connection.execute(
                'SELECT id, role FROM users WHERE id = ?',
                [req.params.userId]
            );

            if (user.length === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            if (user[0].id === req.user.userId) {
                return res.status(400).json({ error: 'Нельзя удалить самого себя' });
            }

            // Удаляем связанные записи
            await connection.execute('DELETE FROM penalties WHERE user_id = ?', [req.params.userId]);
            await connection.execute('DELETE FROM event_participations WHERE user_id = ?', [req.params.userId]);
            await connection.execute('DELETE FROM achievements WHERE user_id = ?', [req.params.userId]);
            
            await connection.execute('UPDATE events SET created_by = NULL WHERE created_by = ?', [req.params.userId]);
            await connection.execute('UPDATE events SET moderated_by = NULL WHERE moderated_by = ?', [req.params.userId]);
            await connection.execute('UPDATE achievements SET created_by = NULL WHERE created_by = ?', [req.params.userId]);
            await connection.execute('UPDATE achievements SET moderated_by = NULL WHERE moderated_by = ?', [req.params.userId]);
            await connection.execute('UPDATE penalties SET issued_by = NULL WHERE issued_by = ?', [req.params.userId]);

            const [result] = await connection.execute(
                'DELETE FROM users WHERE id = ?',
                [req.params.userId]
            );

            await connection.commit();

            res.json({ 
                message: 'Пользователь успешно удален',
                deletedId: req.params.userId 
            });

        } catch (error) {
            await connection.rollback();
            console.error(error);
            res.status(500).json({ error: 'Ошибка при удалении пользователя' });
        } finally {
            connection.release();
        }
    });

    // Получение списка всех пользователей
    router.get('/users', authenticateSpecialist, async (req, res) => {
        try {
            const [users] = await db.execute(
                `SELECT u.id, u.username, u.email, u.full_name, u.role, u.total_rating, 
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

    // Получение всех пользователей для поиска
    router.get('/all-users', authenticateSpecialist, async (req, res) => {
        try {
            const [users] = await db.execute(
                `SELECT u.id, u.full_name, u.username, u.email, u.role, u.total_rating, 
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

    // Создание команды
    router.post('/team', authenticateSpecialist, async (req, res) => {
        const { name } = req.body;

        try {
            const [result] = await db.execute(
                'INSERT INTO teams (name) VALUES (?)',
                [name]
            );

            res.status(201).json({ 
                message: 'Команда успешно создана', 
                teamId: result.insertId 
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка при создании команды' });
        }
    });

    // Получение статистики системы
    router.get('/system-stats', authenticateSpecialist, async (req, res) => {
        try {
            const [totalUsers] = await db.execute('SELECT COUNT(*) as count FROM users');
            const [totalEvents] = await db.execute('SELECT COUNT(*) as count FROM events WHERE status = "approved"');
            const [pendingEvents] = await db.execute('SELECT COUNT(*) as count FROM events WHERE status = "pending"');
            const [pendingAchievements] = await db.execute('SELECT COUNT(*) as count FROM achievements WHERE status = "pending"');
            
            // Топ активистов
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

    async function loadActivistsForPenalty() {
    try {
        const response = await fetch('/specialist/users');
        const users = await response.json();
        
        // Фильтруем только активистов
        allActivists = users.filter(u => u.role === 'activist');
        filteredActivists = [...allActivists];
        
        updatePenaltyUsersList();
        console.log(`✅ Загружено ${allActivists.length} активистов для штрафов`);
        
    } catch (error) {
        console.error('❌ Ошибка загрузки активистов:', error);
    }
}

// Загрузка мероприятий на модерацию
async function loadPendingEvents() {
    try {
        const response = await fetch('/specialist/pending-events');
        const events = await response.json();
        
        const container = document.getElementById('pendingEventsList');
        
        if (events.length === 0) {
            container.innerHTML = '<p>Нет мероприятий на модерации</p>';
            return;
        }
        
        let html = '<table class="table"><tr><th>Мероприятие</th><th>Создатель</th><th>Команда</th><th>Дата</th><th>Масштаб</th><th>Участников</th><th>Действия</th></tr>';
        
        events.forEach(event => {
            html += `<tr>
                <td><a href="/event-view.html?id=${event.id}&role=specialist" style="color: #667eea; text-decoration: none;">${event.title}</a></td>
                <td>${event.creator_name}</td>
                <td>${event.team_name || '—'}</td>
                <td>${new Date(event.event_date).toLocaleDateString()}</td>
                <td>${getScaleName(event.scale)} (${event.scale_value} баллов)</td>
                <td>${event.participants_count || 0}</td>
                <td>
                    <button class="btn btn-success btn-small" onclick="approveEvent(${event.id})">✓ Принять</button>
                    <button class="btn btn-danger btn-small" onclick="showRejectModal(${event.id})">✗ Отклонить</button>
                    <a href="/event-view.html?id=${event.id}&role=specialist" class="btn btn-primary btn-small">Подробнее</a>
                </td>
            </tr>`;
        });
        
        html += '</table>';
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Ошибка загрузки мероприятий:', error);
    }
}

async function changeUserRole(userId, newRole) {
    try {
        const response = await fetch(`/specialist/user/${userId}/role`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ role: newRole })
        });
        
        if (response.ok) {
            // Показываем уведомление об успехе
            const notification = document.createElement('div');
            notification.className = 'notification success';
            notification.textContent = 'Роль успешно изменена';
            document.body.appendChild(notification);
            
            setTimeout(() => notification.remove(), 3000);
            
            // Перезагружаем таблицу
            window.tables['users-table'].loadData();
        } else {
            alert('Ошибка при изменении роли');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка соединения с сервером');
    }
}

// Поиск активистов
function searchPenaltyUsers() {
    const searchText = document.getElementById('penaltyUserSearch').value.toLowerCase();
    
    if (!searchText) {
        filteredActivists = [...allActivists];
    } else {
        filteredActivists = allActivists.filter(user => 
            user.full_name.toLowerCase().includes(searchText)
        );
    }
    
    updatePenaltyUsersList();
}

function showRejectModal(eventId) {
    const reason = prompt('Укажите причину отказа:');
    if (reason !== null) {
        rejectEvent(eventId, reason);
    }
}

// Отклонить мероприятие с причиной
async function rejectEvent(eventId, reason) {
    if (!reason) {
        alert('Укажите причину отказа');
        return;
    }
    
    try {
        const response = await fetch(`/specialist/moderate-event/${eventId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                status: 'rejected',
                reason: reason 
            })
        });
        
        if (response.ok) {
            alert('Мероприятие отклонено');
            loadPendingEvents();
            loadAllEvents();
            loadSystemStats();
        } else {
            const result = await response.json();
            alert(result.error || 'Ошибка при модерации');
        }
        
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка соединения с сервером');
    }
}

// Обновление списка активистов
function updatePenaltyUsersList() {
    const select = document.getElementById('penaltyUser');
    const countSpan = document.getElementById('penaltyUsersCount');
    
    select.innerHTML = '';
    countSpan.textContent = filteredActivists.length;
    
    if (filteredActivists.length === 0) {
        select.innerHTML = '<option value="">Пользователи не найдены</option>';
        return;
    }
    
    filteredActivists.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.full_name} (рейтинг: ${user.total_rating})`;
        select.appendChild(option);
    });
}

// Обновляем функцию showPenaltyModal
function showPenaltyModal() {
    document.getElementById('penaltyModal').style.display = 'block';
    document.getElementById('penaltyForm').reset();
    document.getElementById('penaltyUserSearch').value = '';
    loadActivistsForPenalty();
}

// Получение детальной информации о мероприятии
router.get('/event/:eventId', authenticateSpecialist, async (req, res) => {
    try {
        const [events] = await db.execute(
            `SELECT e.*, 
                    creator.full_name as creator_name,
                    creator.team_id as creator_team_id,
                    moderator.full_name as moderator_name,
                    t.name as team_name
             FROM events e
             JOIN users creator ON e.created_by = creator.id
             LEFT JOIN users moderator ON e.moderated_by = moderator.id
             LEFT JOIN teams t ON creator.team_id = t.id
             WHERE e.id = ?`,
            [req.params.eventId]
        );

        if (events.length === 0) {
            return res.status(404).json({ error: 'Мероприятие не найдено' });
        }

        res.json(events[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка при получении данных мероприятия' });
    }
});

// Получение участников мероприятия
router.get('/event/:eventId/participants', authenticateSpecialist, async (req, res) => {
    try {
        const [participants] = await db.execute(
            `SELECT ep.*, u.full_name, u.team_id, t.name as team_name
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

// Отправка уведомлений
router.post('/send-notifications', authenticateSpecialist, async (req, res) => {
    const { eventId, status, reason, participants, creatorId } = req.body;
    
    try {
        // Получаем информацию о мероприятии
        const [event] = await db.execute(
            'SELECT title FROM events WHERE id = ?',
            [eventId]
        );

        // Создаем уведомления в базе данных
        const notifications = [];
        
        // Для создателя (председателя)
        notifications.push([
            creatorId,
            `Мероприятие "${event[0].title}" ${status === 'approved' ? 'принято' : 'отклонено'}`,
            status === 'approved' 
                ? 'Ваше мероприятие прошло модерацию и баллы начислены участникам.'
                : `Ваше мероприятие отклонено. Причина: ${reason || 'Не указана'}`,
            status,
            eventId
        ]);
        
        // Для участников (только если отклонено)
        if (status === 'rejected') {
            for (const userId of participants) {
                if (userId !== creatorId) {
                    notifications.push([
                        userId,
                        `Мероприятие "${event[0].title}" отклонено`,
                        `Мероприятие, в котором вы участвовали, отклонено модератором. Причина: ${reason || 'Не указана'}`,
                        status,
                        eventId
                    ]);
                }
            }
        }

        // Сохраняем уведомления
        for (const notif of notifications) {
            await db.execute(
                `INSERT INTO notifications (user_id, title, message, type, related_id, created_at) 
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                notif
            );
        }

        res.json({ message: 'Уведомления отправлены', count: notifications.length });
        
    } catch (error) {
        console.error('Ошибка при отправке уведомлений:', error);
        res.status(500).json({ error: 'Ошибка при отправке уведомлений' });
    }
});

// Получение уведомлений пользователя
router.get('/notifications', authenticateToken, async (req, res) => {
    try {
        const db = app.get('db');
        
        const [notifications] = await db.execute(
            `SELECT * FROM notifications 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 50`,
            [req.user.userId]
        );

        res.json(notifications);
    } catch (error) {
        console.error('Ошибка при получении уведомлений:', error);
        res.status(500).json({ error: 'Ошибка при получении уведомлений' });
    }
});

// Отметить уведомление как прочитанное
router.put('/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        const db = app.get('db');
        
        await db.execute(
            'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.userId]
        );

        res.json({ message: 'Уведомление отмечено как прочитанное' });
    } catch (error) {
        console.error('Ошибка при обновлении уведомления:', error);
        res.status(500).json({ error: 'Ошибка при обновлении уведомления' });
    }
});

router.get('/notifications/unread/count', authenticateToken, async (req, res) => {
    try {
        const db = app.get('db');
        
        const [result] = await db.execute(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [req.user.userId]
        );

        res.json({ count: result[0].count });
    } catch (error) {
        console.error('Ошибка при подсчете уведомлений:', error);
        res.status(500).json({ error: 'Ошибка при подсчете уведомлений' });
    }
});

router.put('/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        const db = app.get('db');
        
        await db.execute(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
            [req.user.userId]
        );

        res.json({ message: 'Все уведомления отмечены как прочитанные' });
    } catch (error) {
        console.error('Ошибка при обновлении уведомлений:', error);
        res.status(500).json({ error: 'Ошибка при обновлении уведомлений' });
    }
});

router.post('/send-notifications', authenticateSpecialist, async (req, res) => {
    const { eventId, status, reason, participants, creatorId } = req.body;
    
    try {
        const db = app.get('db');
        
        // Получаем информацию о мероприятии
        const [event] = await db.execute(
            'SELECT title FROM events WHERE id = ?',
            [eventId]
        );

        if (event.length === 0) {
            return res.status(404).json({ error: 'Мероприятие не найдено' });
        }

        // Создаем уведомления в базе данных
        const notifications = [];
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        // Для создателя (председателя)
        notifications.push([
            creatorId,
            `Мероприятие "${event[0].title}" ${status === 'approved' ? 'принято' : 'отклонено'}`,
            status === 'approved' 
                ? 'Ваше мероприятие прошло модерацию и баллы начислены участникам.'
                : `Ваше мероприятие отклонено. Причина: ${reason || 'Не указана'}. Пожалуйста, исправьте замечания и отправьте на повторную модерацию.`,
            status,
            eventId,
            now
        ]);
        
        // Для участников (только если отклонено)
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

        // Сохраняем уведомления
        for (const notif of notifications) {
            await db.execute(
                `INSERT INTO notifications (user_id, title, message, type, related_id, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                notif
            );
        }

        res.json({ 
            message: 'Уведомления отправлены', 
            count: notifications.length 
        });
        
    } catch (error) {
        console.error('Ошибка при отправке уведомлений:', error);
        res.status(500).json({ error: 'Ошибка при отправке уведомлений' });
    }
});

    return router;
};