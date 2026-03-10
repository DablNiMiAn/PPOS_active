-- =====================================================
-- БАЗА ДАННЫХ: activist_rating
-- Система рейтинга активистов
-- =====================================================

-- Создание базы данных (если не существует)
CREATE DATABASE IF NOT EXISTS activist_rating 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE activist_rating;

-- =====================================================
-- ТАБЛИЦА: teams (Команды)
-- =====================================================
CREATE TABLE IF NOT EXISTS teams (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ТАБЛИЦА: users (Пользователи)
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('activist', 'chairman', 'specialist') DEFAULT 'activist',
    team_id INT,
    total_rating INT DEFAULT 0,
    location VARCHAR(50) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
    INDEX idx_users_role (role),
    INDEX idx_users_team (team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ТАБЛИЦА: events (Мероприятия)
-- =====================================================
CREATE TABLE IF NOT EXISTS events (
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
    rejection_reason TEXT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_events_status (status),
    INDEX idx_events_date (event_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ТАБЛИЦА: event_participations (Участие в мероприятиях)
-- =====================================================
CREATE TABLE IF NOT EXISTS event_participations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    event_id INT NOT NULL,
    role ENUM('volunteer', 'media', 'organizer') NOT NULL,
    role_value INT NOT NULL,
    points_earned INT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_event (user_id, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ТАБЛИЦА: achievements (Достижения)
-- =====================================================
CREATE TABLE IF NOT EXISTS achievements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    points INT NOT NULL,
    evidence_path VARCHAR(500) NULL,
    viewed BOOLEAN DEFAULT FALSE,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    created_by INT,
    moderated_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    moderated_at TIMESTAMP NULL,
    rejection_reason TEXT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_achievements_status (status),
    INDEX idx_achievements_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ТАБЛИЦА: penalties (Штрафы)
-- =====================================================
CREATE TABLE IF NOT EXISTS penalties (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    issued_by INT NOT NULL,
    points INT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ТАБЛИЦА: notifications (Уведомления)
-- =====================================================
CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT,
    type ENUM('approved', 'rejected', 'info') DEFAULT 'info',
    related_id INT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_notifications_user (user_id, is_read, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ТАБЛИЦА: calendar_events (События календаря)
-- =====================================================
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
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_calendar_events_date (event_date),
    INDEX idx_calendar_events_team (team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ТАБЛИЦА: calendar_event_teams (Связь событий с командами)
-- =====================================================
CREATE TABLE IF NOT EXISTS calendar_event_teams (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id INT NOT NULL,
    team_id INT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    UNIQUE KEY unique_event_team (event_id, team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ТАБЛИЦА: rating_update_queue (Очередь обновления рейтингов)
-- =====================================================
CREATE TABLE IF NOT EXISTS rating_update_queue (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id INT,
    achievement_id INT,
    user_id INT,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_rating_queue_processed (processed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;