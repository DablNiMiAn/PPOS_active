// ========== БОКОВАЯ ПАНЕЛЬ - УНИВЕРСАЛЬНЫЙ МОДУЛЬ ==========

let sidebarInitialized = false;
window.sidebarUser = null;

// Конфигурация меню по ролям (с путями к SVG иконкам)
const menuConfig = {
    activist: {
        items: [
            { icon: '/images/User Interface/home.svg', text: 'Главная', href: '/dashboard' },
            { icon: '/images/User Interface/shop.svg', text: 'Магазин', href: '/shop' },
            { icon: '/images/User Interface/calendar.svg', text: 'Календарь', href: '/calendar' }
        ]
    },
    chairman: {
        items: [
            { icon: '/images/User Interface/home.svg', text: 'Главная', href: '/dashboard' },
            { icon: '/images/User Interface/event.svg', text: 'Создать мероприятие', href: '/dashboard?modal=event' },
            { icon: '/images/User Interface/reward.svg', text: 'Добавить достижение', href: '/dashboard?modal=achievement' },
            { icon: '/images/User Interface/shop.svg', text: 'Магазин', href: '/shop' },
            { icon: '/images/User Interface/calendar.svg', text: 'Календарь', href: '/calendar' }
        ]
    },
    specialist: {
        items: [
            { icon: '/images/User Interface/home.svg', text: 'Главная', href: '/dashboard' },
            { icon: '/images/User Interface/alert.svg', text: 'Штраф', href: '/dashboard?modal=penalty' },
            { icon: '/images/User Interface/team.svg', text: 'Создать команду', href: '/dashboard?modal=team' },
            { icon: '/images/User Interface/event.svg', text: 'Создать мероприятие', href: '/dashboard?modal=event' },
            { icon: '/images/User Interface/admin.svg', text: 'Управление мерчем', href: '/merch-admin' },
            { icon: '/images/User Interface/shop.svg', text: 'Магазин', href: '/shop' },
            { icon: '/images/User Interface/calendar.svg', text: 'Календарь', href: '/calendar' }
        ]
    }
};

// Инициализация сайдбара
async function initSidebar() {
    if (sidebarInitialized) return;
    
    try {
        const response = await fetch('/api/user');
        if (!response.ok) {
            window.location.href = '/login';
            return;
        }
        
        const user = await response.json();
        window.sidebarUser = user;
        
        updateSidebarProfile(user);
        updateSidebarNav(user.role);
        addMobileOverlay();
        
        sidebarInitialized = true;
        
        // Восстанавливаем состояние сайдбара
        const savedState = localStorage.getItem('sidebarCollapsed');
        if (savedState === 'true') {
            const sidebar = document.getElementById('sidebar');
            const mainContent = document.querySelector('.main-content');
            if (sidebar) sidebar.classList.add('collapsed');
            if (mainContent) mainContent.classList.add('expanded');
        }
        
        handleResize();
        
    } catch (error) {
        console.error('Ошибка инициализации сайдбара:', error);
    }
}

function updateSidebarProfile(user) {
    const avatar = document.getElementById('sidebarAvatar');
    const userName = document.getElementById('sidebarUserName');
    const userRole = document.getElementById('sidebarUserRole');
    
    if (avatar) {
        const initials = user.full_name.split(' ').map(n => n[0]).join('').toUpperCase();
        avatar.textContent = initials;
    }
    
    if (userName) userName.textContent = user.full_name;
    if (userRole) userRole.textContent = getRoleDisplay(user.role);
}

function updateSidebarNav(role) {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    
    const config = menuConfig[role];
    if (!config) return;
    
    nav.innerHTML = '';
    
    config.items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'sidebar-nav-item';
        
        const a = document.createElement('a');
        a.className = 'sidebar-nav-link';
        
        if (item.href === window.location.pathname || 
            (item.href === '/dashboard' && window.location.pathname === '/dashboard')) {
            a.classList.add('active');
        }
        
        // Создаем img для иконки
        const img = document.createElement('img');
        img.src = item.icon;
        img.className = 'sidebar-icon';
        img.alt = item.text;
        
        // Создаем span для текста
        const span = document.createElement('span');
        span.textContent = item.text;
        
        a.appendChild(img);
        a.appendChild(span);
        a.href = item.href;
        
        li.appendChild(a);
        nav.appendChild(li);
    });
    
    // Пункт выхода
    const logoutLi = document.createElement('li');
    logoutLi.className = 'sidebar-nav-item';
    const logoutA = document.createElement('a');
    logoutA.className = 'sidebar-nav-link';
    logoutA.href = '#';
    logoutA.onclick = (e) => {
        e.preventDefault();
        showLogoutConfirm();
    };
    
    const logoutImg = document.createElement('img');
    logoutImg.src = '/images/User Interface/Backspace.svg';
    logoutImg.className = 'sidebar-icon';
    logoutImg.alt = 'Выход';
    
    const logoutSpan = document.createElement('span');
    logoutSpan.textContent = 'Выход';
    
    logoutA.appendChild(logoutImg);
    logoutA.appendChild(logoutSpan);
    logoutLi.appendChild(logoutA);
    nav.appendChild(logoutLi);
}

function addMobileOverlay() {
    if (!document.querySelector('.sidebar-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.onclick = closeMobileMenu;
        document.body.appendChild(overlay);
    }
}

function handleResize() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    if (window.innerWidth > 768) {
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    if (!sidebar) return;
    
    sidebar.classList.toggle('mobile-open');
    if (overlay) overlay.classList.toggle('active');
    
    document.body.style.overflow = sidebar.classList.contains('mobile-open') ? 'hidden' : '';
}

function closeMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.querySelector('.main-content');
    
    if (!sidebar || !mainContent) return;
    
    sidebar.classList.toggle('collapsed');
    mainContent.classList.toggle('expanded');
    
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
}

// ==================== ФУНКЦИИ ВЫХОДА ====================
function showLogoutConfirm() {
    const modal = document.getElementById('logoutModal');
    if (modal) {
        modal.style.display = 'block';
    } else {
        confirmLogout();
    }
}

function closeLogoutModal() {
    const modal = document.getElementById('logoutModal');
    if (modal) modal.style.display = 'none';
}

async function confirmLogout() {
    try {
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    } catch (error) {
        console.error('Ошибка при выходе:', error);
        alert('Произошла ошибка при выходе');
    }
}

// ==================== ПРОФИЛЬ ====================
function showProfile() {
    const userId = window.sidebarUser?.id;
    const role = window.sidebarUser?.role;
    if (userId && role) {
        window.location.href = `/profile.html?id=${userId}&role=${role}`;
    }
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function getRoleDisplay(role) {
    const roles = {
        'activist': 'Активист',
        'chairman': 'Председатель',
        'specialist': 'Специалист'
    };
    return roles[role] || role;
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
});