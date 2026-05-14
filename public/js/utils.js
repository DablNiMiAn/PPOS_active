// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

// Экранирование HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Форматирование даты
function formatDate(dateString) {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('ru-RU');
}

// Получение названия статуса
function getStatusName(status) {
    const statuses = {
        'pending': 'На модерации',
        'approved': 'Принято',
        'rejected': 'Отклонено'
    };
    return statuses[status] || status;
}

// Получение названия масштаба мероприятия
function getScaleName(scale) {
    const scales = {
        'institute': 'Институтское',
        'university': 'Университетское',
        'city': 'Городское',
        'regional': 'Региональное',
        'district': 'Окружное',
        'federal': 'Федеральное'
    };
    return scales[scale] || scale;
}

// Получение названия роли на мероприятии
function getEventRoleName(role) {
    const roles = {
        'volunteer': 'Волонтер',
        'media': 'Медиа',
        'organizer': 'Организатор'
    };
    return roles[role] || role;
}

// Получение названия роли пользователя
function getRoleDisplay(role) {
    const roles = {
        'activist': 'Активист',
        'chairman': 'Председатель',
        'specialist': 'Специалист'
    };
    return roles[role] || role;
}

// Показ уведомления
let notificationTimeout;
function showNotification(message, type = 'success') {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span><span>${message}</span>`;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        z-index: 1100;
        animation: slideIn 0.3s ease;
        background: ${type === 'success' ? '#48bb78' : '#f56565'};
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    `;
    
    document.body.appendChild(notification);
    
    if (notificationTimeout) clearTimeout(notificationTimeout);
    notificationTimeout = setTimeout(() => notification.remove(), 3000);
}

// API запросы
async function apiGet(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return null;
    }
}

async function apiPost(url, data) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('API Error:', error);
        return { ok: false, data: { error: error.message } };
    }
}

async function apiPut(url, data) {
    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('API Error:', error);
        return { ok: false, data: { error: error.message } };
    }
}

async function apiDelete(url) {
    try {
        const response = await fetch(url, { method: 'DELETE' });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('API Error:', error);
        return { ok: false, data: { error: error.message } };
    }
}

// Добавляем стили
if (!document.querySelector('#utils-styles')) {
    const style = document.createElement('style');
    style.id = 'utils-styles';
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        .btn-hint {
            background: #4299e1;
            color: white;
            border: none;
            border-radius: 5px;
            padding: 10px 15px;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn-hint:hover {
            background: #3182ce;
            transform: translateY(-2px);
        }
        .btn-close-hint {
            background: none;
            border: none;
            font-size: 1.2rem;
            cursor: pointer;
            color: #999;
            transition: color 0.3s;
        }
        .btn-close-hint:hover {
            color: #333;
        }
    `;
    document.head.appendChild(style);
}