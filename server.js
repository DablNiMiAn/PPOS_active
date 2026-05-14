const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const session = require('express-session');
// const fileUpload = require('express-fileupload');
const path = require('path');
const { initVKBot } = require('./utils/vk-bot');
require('dotenv').config();

const app = express();
initVKBot();



// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
//app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

// Сессии
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    req.isMobile = isMobile;
    next();
});

// Подключение к БД
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'activist_rating',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Делаем pool доступным во всех роутах
app.set('db', pool);

// ============================================
// Middleware для проверки аутентификации
// ============================================
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Недействительный токен' });
        }
        req.user = user;
        next();
    });
};

// ============================================
// ПРОВЕРКА И СОЗДАНИЕ ТАБЛИЦ КАЛЕНДАРЯ
// ============================================
async function ensureCalendarTables() {
    try {
        const db = app.get('db');
        
        // Проверяем и создаем таблицу calendar_events
        await db.execute(`
            CREATE TABLE IF NOT EXISTS calendar_events (
                id INT PRIMARY KEY AUTO_INCREMENT,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                event_date DATE NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                location VARCHAR(255),
                team_id INT,
                created_by INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Таблица calendar_events проверена/создана');

        // Проверяем и создаем таблицу calendar_event_teams
        await db.execute(`
            CREATE TABLE IF NOT EXISTS calendar_event_teams (
                id INT PRIMARY KEY AUTO_INCREMENT,
                event_id INT NOT NULL,
                team_id INT NOT NULL,
                FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                UNIQUE KEY unique_event_team (event_id, team_id)
            )
        `);
        console.log('✅ Таблица calendar_event_teams проверена/создана');

    } catch (error) {
        console.error('❌ Ошибка при создании таблиц календаря:', error);
    }
}

// Вызываем функцию после подключения к БД
ensureCalendarTables();

// ============================================
// API МАРШРУТЫ (ВСЕ API ДОЛЖНЫ БЫТЬ ЗДЕСЬ)
// ============================================

// Исправленный API для календаря
app.get('/api/calendar-fixed', authenticateToken, async (req, res) => {
    try {
        const db = app.get('db');
        
        const [events] = await db.execute(`
            SELECT 
                ce.id,
                ce.title,
                ce.description,
                ce.event_date,
                ce.start_time,
                ce.end_time,
                ce.location,
                ce.team_id,
                t.name as team_name
            FROM calendar_events ce
            LEFT JOIN teams t ON ce.team_id = t.id
            ORDER BY ce.event_date DESC
        `);
        
        console.log('Сырые данные из БД:', events);
        
        const formatted = events.map(event => {
            // Преобразуем дату в строку YYYY-MM-DD
            let dateStr;
            if (event.event_date) {
                const d = new Date(event.event_date);
                if (!isNaN(d.getTime())) {
                    const year = d.getFullYear();
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    dateStr = `${year}-${month}-${day}`;
                } else {
                    // Если дата невалидна, используем сегодня
                    const today = new Date();
                    dateStr = today.toISOString().split('T')[0];
                }
            } else {
                dateStr = new Date().toISOString().split('T')[0];
            }
            
            // Время
            const startTime = event.start_time ? event.start_time.substring(0,5) : '10:00';
            const endTime = event.end_time ? event.end_time.substring(0,5) : 
                           (parseInt(startTime.split(':')[0]) + 1).toString().padStart(2,'0') + ':' + startTime.split(':')[1];
            
            return {
                id: event.id,
                title: event.title || 'Без названия',
                start: `${dateStr}T${startTime}:00`,
                end: `${dateStr}T${endTime}:00`,
                backgroundColor: event.team_id ? '#bf5254' : '#805ad5',
                borderColor: event.team_id ? '#bf5254' : '#805ad5',
                extendedProps: {
                    description: event.description || '',
                    location: event.location || '',
                    teamId: event.team_id,
                    teamName: event.team_name || (event.team_id ? 'Команда' : 'Общее мероприятие')
                }
            };
        });
        
        console.log('Отправляем события:', formatted.length);
        res.json(formatted);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/achievement-detail.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'achievement-detail.html'));
});

// Получение всех событий в простом формате
app.get('/api/simple-calendar-events', authenticateToken, async (req, res) => {
    try {
        const db = app.get('db');
        
        // Проверяем существование таблицы
        try {
            await db.execute('SELECT 1 FROM calendar_events LIMIT 1');
        } catch (error) {
            return res.json([]);
        }
        
        const [events] = await db.execute(`
            SELECT 
                id,
                title,
                event_date,
                start_time,
                end_time,
                location,
                description
            FROM calendar_events 
            ORDER BY event_date DESC
        `);
        
        console.log('Сырые данные из БД:', events);
        
        // Преобразуем в формат для календаря
        const formattedEvents = events.map(event => {
            // Проверяем и форматируем дату правильно
            let startStr = '';
            let endStr = '';
            
            if (event.event_date) {
                // Убеждаемся, что дата в формате YYYY-MM-DD
                const dateStr = event.event_date;
                
                // Время начала (по умолчанию 10:00 если нет)
                const startTime = event.start_time ? event.start_time.substring(0,5) : '10:00';
                
                // Время окончания (по умолчанию +1 час если нет)
                const endTime = event.end_time ? event.end_time.substring(0,5) : 
                               (event.start_time ? 
                                (parseInt(event.start_time.split(':')[0]) + 1).toString().padStart(2,'0') + ':' + 
                                event.start_time.split(':')[1] : '11:00');
                
                startStr = `${dateStr}T${startTime}:00`;
                endStr = `${dateStr}T${endTime}:00`;
            }
            
            return {
                id: event.id,
                title: event.title || 'Без названия',
                start: startStr,
                end: endStr,
                description: event.description || '',
                location: event.location || '',
                color: '#bf5254'
            };
        });
        
        console.log('Отформатированные события:', formattedEvents);
        res.json(formattedEvents);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.json([]);
    }
});

app.get('/final-calendar', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'final-calendar.html'));
});

// Получение текущего пользователя
app.get('/api/user', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const db = app.get('db');
        
        const [users] = await db.execute(
            `SELECT u.*, t.name as team_name 
             FROM users u 
             LEFT JOIN teams t ON u.team_id = t.id 
             WHERE u.id = ?`,
            [decoded.userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const user = users[0];
        delete user.password_hash;
        
        res.json(user);
    } catch (error) {
        console.error(error);
        res.status(401).json({ error: 'Недействительный токен' });
    }
});

// Получение информации о пользователе по ID
app.get('/api/user/:userId', async (req, res) => {
    try {
        const db = app.get('db');
        
        const [users] = await db.execute(
            `SELECT u.*, t.name as team_name 
             FROM users u 
             LEFT JOIN teams t ON u.team_id = t.id 
             WHERE u.id = ?`,
            [req.params.userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const user = users[0];
        
        // Получаем информацию о текущем пользователе из токена
        const token = req.cookies.token;
        let viewerId = null;
        let viewerRole = null;
        let viewerTeamId = null;
        
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                viewerId = decoded.userId;
                
                const [viewer] = await db.execute(
                    'SELECT role, team_id FROM users WHERE id = ?',
                    [viewerId]
                );
                if (viewer.length > 0) {
                    viewerRole = viewer[0].role;
                    viewerTeamId = viewer[0].team_id;
                }
            } catch (e) {
                console.error('Ошибка проверки токена:', e);
            }
        }
        
        // Определяем, может ли просматривающий видеть контактную информацию
        let canSeeContactInfo = false;
        
        if (viewerRole === 'specialist') {
            canSeeContactInfo = true;
        } else if (viewerRole === 'chairman' && viewerTeamId && user.team_id === viewerTeamId) {
            canSeeContactInfo = true;
        } else if (viewerId === user.id) {
            canSeeContactInfo = true;
        }
        
        // Удаляем пароль
        delete user.password_hash;
        
        // Если нет прав, скрываем контактную информацию
        if (!canSeeContactInfo) {
            delete user.email;
            delete user.username;
        }
        
        res.json(user);
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.put('/api/user/:userId/location', async (req, res) => {
    // Используйте req.params.userId, а не req.params.id
    const userId = req.params.userId;
    const { location } = req.body;

    // Проверяем, что userId и location переданы
    if (!userId || !location) {
        return res.status(400).json({ error: 'Отсутствует ID пользователя или местоположение' });
    }

    try {
        const db = app.get('db');

        // Выполняем запрос на обновление
        const [result] = await db.query(
            'UPDATE users SET location = ? WHERE id = ?',
            [location, userId]
        );

        // Проверяем, что запись была обновлена
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при обновлении местоположения:', err);
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.get('/shop-mobile', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'mobile', 'shop-mobile.html'));
});

// Получение мероприятий пользователя
app.get('/api/user/:userId/events', async (req, res) => {
    try {
        const db = app.get('db');
        
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

// Получение достижений пользователя
app.get('/api/user/:userId/achievements', async (req, res) => {
    try {
        const db = app.get('db');
        
        const [achievements] = await db.execute(
            `SELECT * FROM achievements 
             WHERE user_id = ? AND status = 'approved'
             ORDER BY created_at DESC`,
            [req.params.userId]
        );
        
        res.json(achievements);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение штрафов пользователя
app.get('/api/user/:userId/penalties', async (req, res) => {
    try {
        const db = app.get('db');
        
        const [penalties] = await db.execute(
            `SELECT * FROM penalties 
             WHERE user_id = ? 
             ORDER BY created_at DESC`,
            [req.params.userId]
        );
        
        res.json(penalties);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение списка команд
app.get('/api/teams', async (req, res) => {
    try {
        const db = app.get('db');
        const [teams] = await db.execute('SELECT id, name FROM teams ORDER BY name');
        res.json(teams);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение деталей мероприятия
app.get('/api/event/:eventId', async (req, res) => {
    try {
        const db = app.get('db');
        
        const [events] = await db.execute(
            `SELECT e.*, 
                    creator.full_name as creator_name,
                    creator.team_id as creator_team_id,
                    moderator.full_name as moderator_name,
                    t.name as team_name,
                    e.moderated_at
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
app.get('/api/event/:eventId/participants', async (req, res) => {
    try {
        const db = app.get('db');
        
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

// Получение топ-рейтинга
app.get('/api/top-rating', async (req, res) => {
    try {
        const db = app.get('db');
        
        const [users] = await db.execute(
            `SELECT u.id, u.full_name, u.total_rating, t.name as team_name 
             FROM users u 
             LEFT JOIN teams t ON u.team_id = t.id 
             WHERE u.role IN ('activist', 'chairman')
             ORDER BY u.total_rating DESC 
             LIMIT 10`
        );
        
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============================================
// МАРШРУТЫ КАЛЕНДАРЯ
// ============================================

// Получение всех событий календаря
app.get('/api/calendar/events', authenticateToken, async (req, res) => {
    console.log('📅 ЗАПРОС СОБЫТИЙ КАЛЕНДАРЯ');
    
    try {
        const db = app.get('db');
        
        const [events] = await db.execute(`
            SELECT ce.*, 
                   t.name as team_name,
                   u.full_name as creator_name,
                   GROUP_CONCAT(DISTINCT cet.team_id) as team_ids,
                   GROUP_CONCAT(DISTINCT t2.name) as teams_names
            FROM calendar_events ce
            LEFT JOIN teams t ON ce.team_id = t.id
            LEFT JOIN users u ON ce.created_by = u.id
            LEFT JOIN calendar_event_teams cet ON ce.id = cet.event_id
            LEFT JOIN teams t2 ON cet.team_id = t2.id
            GROUP BY ce.id
            ORDER BY ce.event_date DESC
        `);
        
        console.log(`✅ Найдено ${events.length} событий`);
        
        // Преобразуем team_ids в массив
        events.forEach(event => {
            if (event.team_ids) {
                event.teams = event.team_ids.split(',').map(Number);
            }
            if (event.teams_names) {
                event.teams_names = event.teams_names.split(',');
            }
        });
        
        res.json(events);
    } catch (error) {
        console.error('❌ Ошибка при получении событий календаря:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }
});

// Получение конкретного события
app.get('/api/calendar/events/:id', authenticateToken, async (req, res) => {
    try {
        const db = app.get('db');
        
        const [events] = await db.execute(`
            SELECT ce.*, 
                   t.name as team_name,
                   u.full_name as creator_name,
                   GROUP_CONCAT(DISTINCT cet.team_id) as team_ids,
                   GROUP_CONCAT(DISTINCT t2.name) as teams_names
            FROM calendar_events ce
            LEFT JOIN teams t ON ce.team_id = t.id
            LEFT JOIN users u ON ce.created_by = u.id
            LEFT JOIN calendar_event_teams cet ON ce.id = cet.event_id
            LEFT JOIN teams t2 ON cet.team_id = t2.id
            WHERE ce.id = ?
            GROUP BY ce.id
        `, [req.params.id]);
        
        if (events.length === 0) {
            return res.status(404).json({ error: 'Событие не найдено' });
        }
        
        const event = events[0];
        if (event.team_ids) {
            event.teams = event.team_ids.split(',').map(Number);
        }
        if (event.teams_names) {
            event.teams_names = event.teams_names.split(',');
        }
        
        res.json(event);
    } catch (error) {
        console.error('❌ Ошибка при получении события:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создание события
app.post('/api/calendar/events', authenticateToken, async (req, res) => {
    console.log('📅 Создание события, получены данные:', req.body);
    
    const { title, description, event_date, start_time, end_time, location, team_id } = req.body;
    
    if (!title || !event_date || !start_time) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }
    
    // Используем end_time или копируем start_time
    const finalEndTime = end_time || start_time;
    
    // Преобразуем team_id: если это строка 'public' или пустая, сохраняем как NULL
    let finalTeamId = null;
    if (team_id && team_id !== '' && team_id !== 'public') {
        finalTeamId = team_id;
    }
    
    console.log('Обработанные данные:', {
        title,
        description,
        event_date,
        start_time,
        end_time: finalEndTime,
        location,
        team_id: finalTeamId,
        created_by: req.user.userId
    });
    
    try {
        const db = app.get('db');
        
        const [result] = await db.execute(`
            INSERT INTO calendar_events (title, description, event_date, start_time, end_time, location, team_id, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            title,
            description || null,
            event_date,
            start_time,
            finalEndTime,
            location || null,
            finalTeamId,
            req.user.userId
        ]);
        
        console.log('✅ Событие создано, ID:', result.insertId);
        
        res.status(201).json({ 
            message: 'Мероприятие создано', 
            eventId: result.insertId 
        });
        
    } catch (error) {
        console.error('❌ Ошибка при создании события:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }
});

// Обновление события
app.put('/api/calendar/events/:id', authenticateToken, async (req, res) => {
    const { title, description, event_date, start_time, end_time, location, team_id } = req.body;
    
    const connection = await app.get('db').getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Проверяем существование события
        const [events] = await connection.execute(
            'SELECT * FROM calendar_events WHERE id = ?',
            [req.params.id]
        );
        
        if (events.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Событие не найдено' });
        }
        
        const event = events[0];
        
        // Получаем информацию о пользователе
        const [users] = await connection.execute(
            'SELECT role, team_id FROM users WHERE id = ?',
            [req.user.userId]
        );
        
        const user = users[0];
        
        // Проверка прав
        if (user.role === 'chairman') {
            if (event.team_id !== user.team_id) {
                await connection.rollback();
                return res.status(403).json({ error: 'Нет прав для редактирования этого мероприятия' });
            }
        }
        
        // Обновляем событие
        await connection.execute(`
            UPDATE calendar_events 
            SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?, location = ?, team_id = ?
            WHERE id = ?
        `, [
            title, 
            description, 
            event_date, 
            start_time, 
            end_time, 
            location, 
            team_id && team_id !== 'public' ? team_id : null, 
            req.params.id
        ]);
        
        await connection.commit();
        
        res.json({ message: 'Мероприятие обновлено' });
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Ошибка при обновлении события:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    } finally {
        connection.release();
    }
});



// Удаление события
app.delete('/api/calendar/events/:id', authenticateToken, async (req, res) => {
    const connection = await app.get('db').getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Проверяем существование события
        const [events] = await connection.execute(
            'SELECT * FROM calendar_events WHERE id = ?',
            [req.params.id]
        );
        
        if (events.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Событие не найдено' });
        }
        
        const event = events[0];
        
        // Получаем информацию о пользователе
        const [users] = await connection.execute(
            'SELECT role, team_id FROM users WHERE id = ?',
            [req.user.userId]
        );
        
        const user = users[0];
        
        // Проверка прав
        if (user.role === 'chairman' && event.team_id !== user.team_id) {
            await connection.rollback();
            return res.status(403).json({ error: 'Нет прав для удаления этого мероприятия' });
        }
        
        // Удаляем связи
        await connection.execute('DELETE FROM calendar_event_teams WHERE event_id = ?', [req.params.id]);
        
        // Удаляем событие
        await connection.execute('DELETE FROM calendar_events WHERE id = ?', [req.params.id]);
        
        await connection.commit();
        
        res.json({ message: 'Мероприятие удалено' });
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Ошибка при удалении события:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    } finally {
        connection.release();
    }
});

// ============================================
// ИМПОРТ РОУТОВ
// ============================================

const authRoutes = require('./routes/auth')(app);
const activistRoutes = require('./routes/activist')(app);
const chairmanRoutes = require('./routes/chairman')(app);
const specialistRoutes = require('./routes/specialist')(app);
const shopRoutes = require('./routes/shop')(app);

// Использование роутов
app.use('/auth', authRoutes);
app.use('/activist', activistRoutes);
app.use('/chairman', chairmanRoutes);
app.use('/specialist', specialistRoutes);
app.use('/api/shop', shopRoutes); 
// ============================================
// СТРАНИЦЫ HTML
// ============================================

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Страница входа
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Страница регистрации
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

// Страница календаря
app.get('/calendar', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const isMobile = req.isMobile || false;
        
        // Если мобильное устройство - показываем мобильную версию
        if (isMobile) {
            res.sendFile(path.join(__dirname, 'views', 'mobile', 'calendar-mobile.html'));
        } else {
            res.sendFile(path.join(__dirname, 'views', 'calendar.html'));
        }
    } catch (error) {
        res.clearCookie('token');
        res.redirect('/login');
    }
});

// Страница дашборда
app.get('/dashboard', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const db = app.get('db');
        
        const [users] = await db.execute(
            'SELECT role FROM users WHERE id = ?',
            [decoded.userId]
        );
        
        if (users.length === 0) {
            return res.redirect('/login');
        }
        
        const role = users[0].role;
        const isMobile = req.isMobile;
        
        // Если мобильное устройство - показываем мобильную версию
        if (isMobile) {
            switch(role) {
                case 'activist':
                    res.sendFile(path.join(__dirname, 'views', 'mobile', 'activist-mobile.html'));
                    break;
                case 'chairman':
                    res.sendFile(path.join(__dirname, 'views', 'mobile', 'chairman-mobile.html'));
                    break;
                case 'specialist':
                    res.sendFile(path.join(__dirname, 'views', 'mobile', 'specialist-mobile.html'));
                    break;
                default:
                    res.redirect('/login');
            }
        } else {
            // Десктопная версия
            switch(role) {
                case 'activist':
                    res.sendFile(path.join(__dirname, 'views', 'dashboard', 'activist.html'));
                    break;
                case 'chairman':
                    res.sendFile(path.join(__dirname, 'views', 'dashboard', 'chairman.html'));
                    break;
                case 'specialist':
                    res.sendFile(path.join(__dirname, 'views', 'dashboard', 'specialist.html'));
                    break;
                default:
                    res.redirect('/login');
            }
        }
    } catch (error) {
        res.clearCookie('token');
        res.redirect('/login');
    }
});

app.get('/shop', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'shop.html'));
});

app.get('/merch-admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'merch-admin.html'));
});

// API для получения информации о достижении
app.get('/api/achievement/:id', async (req, res) => {
    try {
        const db = app.get('db');
        
        const [achievements] = await db.execute(
            `SELECT a.*, 
                    u.full_name as user_name,
                    u.team_id as user_team_id,
                    t.name as user_team,
                    creator.full_name as creator_name,
                    creator.role as creator_role,
                    moderator.full_name as moderator_name
             FROM achievements a
             JOIN users u ON a.user_id = u.id
             JOIN users creator ON a.created_by = creator.id
             LEFT JOIN users moderator ON a.moderated_by = moderator.id
             LEFT JOIN teams t ON u.team_id = t.id
             WHERE a.id = ?`,
            [req.params.id]
        );

        if (achievements.length === 0) {
            return res.status(404).json({ error: 'Достижение не найдено' });
        }

        res.json(achievements[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка при получении данных достижения' });
    }
});



// Маршрут для страницы просмотра достижения
app.get('/achievement-detail.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'achievement-detail.html'));
});

// Отправка уведомлений о модерации достижения
app.post('/api/send-achievement-notifications', async (req, res) => {
    const { achievementId, status, reason, userId, creatorId } = req.body;
    
    try {
        const db = app.get('db');
        
        // Получаем информацию о достижении
        const [achievement] = await db.execute(
            'SELECT title FROM achievements WHERE id = ?',
            [achievementId]
        );

        if (achievement.length === 0) {
            return res.status(404).json({ error: 'Достижение не найдено' });
        }

        // Создаем уведомления
        const notifications = [];
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        // Для активиста
        notifications.push([
            userId,
            `Достижение "${achievement[0].title}" ${status === 'approved' ? 'принято' : 'отклонено'}`,
            status === 'approved' 
                ? `Ваше достижение "${achievement[0].title}" принято и баллы начислены.`
                : `Ваше достижение "${achievement[0].title}" отклонено. Причина: ${reason || 'Не указана'}`,
            status,
            achievementId,
            now
        ]);
        
        // Для создателя (если это не сам активист)
        if (creatorId !== userId) {
            notifications.push([
                creatorId,
                `Достижение для пользователя ${status === 'approved' ? 'принято' : 'отклонено'}`,
                status === 'approved' 
                    ? `Созданное вами достижение "${achievement[0].title}" принято модератором.`
                    : `Созданное вами достижение "${achievement[0].title}" отклонено. Причина: ${reason || 'Не указана'}`,
                status,
                achievementId,
                now
            ]);
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

// Страница профиля
app.get('/profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'profile.html'));
});

// Страница деталей мероприятия
app.get('/event-detail.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'event-detail.html'));
});

// Страница просмотра мероприятия
app.get('/event-view.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'event-view.html'));
});

// Страница редактирования мероприятия для председателя
app.get('/chairman-event-edit.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'chairman-event-edit.html'));
});

app.get('/chairman-achievement-edit.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'chairman-achievement-edit.html'));
});


app.get('/achievement-view.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'achievement-view.html'));
});

// Страницы восстановления пароля
app.get('/forgot-password.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'forgot-password.html'));
});

app.get('/reset-password.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'reset-password.html'));
});

// Страница завершения регистрации
app.get('/complete-registration.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'complete-registration.html'));
});

app.get('/api/test', (req, res) => {
    console.log('✅ ТЕСТОВЫЙ МАРШРУТ СРАБОТАЛ');
    res.json({ success: true, message: 'Сервер работает' });
});

app.get('/api/check-vk/:vkId', async (req, res) => {
    try {
        const db = app.get('db');
        const vkId = req.params.vkId.replace('@', '');
        
        console.log(`🔍 Проверка VK ID: ${vkId}`);
        
        const [users] = await db.execute(
            'SELECT id, username FROM users WHERE vk_id = ?',
            [vkId]
        );
        
        const exists = users.length > 0;
        console.log(`📊 VK ID ${vkId}: ${exists ? 'ЗАНЯТ' : 'СВОБОДЕН'}`);
        
        res.json({ 
            exists: exists,
            message: exists ? 'VK ID уже используется' : 'VK ID доступен'
        });
    } catch (error) {
        console.error('❌ Ошибка проверки VK ID:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на http://${getLocalIp()}:${PORT}`);
});

// Функция для получения локального IP
function getLocalIp() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}