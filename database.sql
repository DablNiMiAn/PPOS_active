-- Создание базы данных
CREATE DATABASE IF NOT EXISTS activist_rating;
USE activist_rating;

-- Таблица команд
CREATE TABLE teams (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица пользователей
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('activist', 'chairman', 'specialist') DEFAULT 'activist',
    team_id INT,
    total_rating INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

-- Таблица мероприятий
CREATE TABLE events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    scale ENUM('institute', 'university', 'city', 'regional', 'district', 'federal') NOT NULL,
    scale_value INT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    created_by INT,
    moderated_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    moderated_at TIMESTAMP NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Таблица участия в мероприятиях
CREATE TABLE event_participations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    event_id INT NOT NULL,
    role ENUM('volunteer', 'media', 'organizer') NOT NULL,
    role_value INT NOT NULL,
    points_earned INT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Таблица достижений
CREATE TABLE achievements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    points INT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    created_by INT,
    moderated_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    moderated_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Таблица штрафов
CREATE TABLE penalties (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    issued_by INT NOT NULL,
    points INT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Вставка тестовых команд
INSERT INTO teams (name) VALUES 
('Волонтеры'),
('Медиагруппа'),
('Организаторы');

-- Вставка тестового специалиста (пароль: admin123)
INSERT INTO users (username, email, password_hash, full_name, role) VALUES 
('admin', 'admin@example.com', '$2a$10$YourHashedPasswordHere', 'Главный специалист', 'specialist');

-- Создание индексов для оптимизации
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_team ON users(team_id);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_achievements_status ON achievements(status);
-- Добавление индексов для оптимизации
CREATE INDEX idx_events_status_created ON events(status, created_at);
CREATE INDEX idx_achievements_status_created ON achievements(status, created_at);
CREATE INDEX idx_users_role_team ON users(role, team_id);

-- Триггер для автоматического обновления рейтинга при изменении участия в мероприятии
DELIMITER //
CREATE TRIGGER update_rating_on_participation
AFTER UPDATE ON events
FOR EACH ROW
BEGIN
    IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
        -- Обновление рейтинга будет происходить через процедуру recalculateUserRating
        -- Это сигнал для приложения пересчитать рейтинги
        INSERT INTO rating_update_queue (event_id) VALUES (NEW.id);
    END IF;
END//
DELIMITER ;

-- Таблица для очереди обновления рейтингов
CREATE TABLE rating_update_queue (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id INT,
    achievement_id INT,
    user_id INT,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);