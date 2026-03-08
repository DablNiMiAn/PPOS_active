const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

// Сессии
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 часа
}));

// Подключение к БД
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Делаем pool доступным во всех роутах
app.set('db', pool);

// Импорт роутов
const authRoutes = require('./routes/auth')(app);
const activistRoutes = require('./routes/activist')(app);
const chairmanRoutes = require('./routes/chairman')(app);
const specialistRoutes = require('./routes/specialist')(app);

// Использование роутов
app.use('/auth', authRoutes);
app.use('/activist', activistRoutes);
app.use('/chairman', chairmanRoutes);
app.use('/specialist', specialistRoutes);

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Страницы
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

app.get('/event-detail.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'event-detail.html'));
});

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
    } catch (error) {
        res.clearCookie('token');
        res.redirect('/login');
    }
});

app.get('/chairman-event-edit.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'chairman-event-edit.html'));
});

// Маршрут для просмотра мероприятия
app.get('/event-view.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'event-view.html'));
});

// API для получения данных пользователя
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
        res.status(401).json({ error: 'Недействительный токен' });
    }
});

// API для получения топ рейтинга
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

app.get('/api/teams', async (req, res) => {
    try {
        const db = app.get('db');
        const [teams] = await db.execute('SELECT id, name FROM teams ORDER BY name');
        res.json(teams);
    } catch (error) {
        console.error('Ошибка при получении команд:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Маршрут для страницы профиля
app.get('/profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'profile.html'));
});

// API для получения информации о пользователе
app.get('/api/user/:userId', async (req, res) => {
    try {
        const db = app.get('db');
        
        // Получаем информацию о запрашиваемом пользователе
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
                
                // Получаем данные текущего пользователя
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
            // Свой профиль всегда видишь полностью
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

// API для получения мероприятий пользователя
app.get('/api/user/:userId/events', async (req, res) => {
    try {
        const db = app.get('db');
        console.log(`📋 Запрос мероприятий для пользователя ${req.params.userId}`);
        
        const [events] = await db.execute(
            `SELECT e.*, ep.role, ep.points_earned 
             FROM events e 
             JOIN event_participations ep ON e.id = ep.event_id 
             WHERE ep.user_id = ? 
             ORDER BY e.event_date DESC`,
            [req.params.userId]
        );
        
        console.log(`✅ Найдено ${events.length} мероприятий`);
        res.json(events);
    } catch (error) {
        console.error('❌ Ошибка при получении мероприятий пользователя:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// API для получения достижений пользователя
app.get('/api/user/:userId/achievements', async (req, res) => {
    try {
        const db = app.get('db');
        console.log(`📋 Запрос достижений для пользователя ${req.params.userId}`);
        
        const [achievements] = await db.execute(
            `SELECT * FROM achievements 
             WHERE user_id = ? AND status = 'approved'
             ORDER BY created_at DESC`,
            [req.params.userId]
        );
        
        console.log(`✅ Найдено ${achievements.length} достижений`);
        res.json(achievements);
    } catch (error) {
        console.error('❌ Ошибка при получении достижений пользователя:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// API для получения штрафов пользователя
app.get('/api/user/:userId/penalties', async (req, res) => {
    try {
        const db = app.get('db');
        console.log(`📋 Запрос штрафов для пользователя ${req.params.userId}`);
        
        const [penalties] = await db.execute(
            `SELECT * FROM penalties 
             WHERE user_id = ? 
             ORDER BY created_at DESC`,
            [req.params.userId]
        );
        
        console.log(`✅ Найдено ${penalties.length} штрафов`);
        res.json(penalties);
    } catch (error) {
        console.error('❌ Ошибка при получении штрафов пользователя:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// API для сохранения площадки специалиста
app.put('/api/user/:userId/location', async (req, res) => {
    try {
        const db = app.get('db');
        const { location } = req.body;
        
        await db.execute(
            'UPDATE users SET location = ? WHERE id = ?',
            [location, req.params.userId]
        );
        
        res.json({ message: 'Информация сохранена' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

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



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});