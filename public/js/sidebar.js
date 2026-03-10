// ========== БОКОВАЯ ПАНЕЛЬ СПРАВА ==========

let sidebarInitialized = false;

window.sidebarUser = null;

async function initSidebar() {
    if (sidebarInitialized) return;
    
    try {
        const response = await fetch('/api/user');
        const user = await response.json();
        
        // Сохраняем глобально
        window.sidebarUser = user;
        
        // Обновляем профиль в сайдбаре
        updateSidebarProfile(user);
        
        // Обновляем навигационное меню в зависимости от роли
        updateSidebarNav(user.role);
        
        sidebarInitialized = true;
        
        // Проверяем сохраненное состояние сайдбара
        const savedState = localStorage.getItem('sidebarCollapsed');
        if (savedState === 'true') {
            document.getElementById('sidebar').classList.add('collapsed');
            document.querySelector('.main-content').classList.add('expanded');
            const toggleBtn = document.querySelector('.sidebar-toggle i');
            if (toggleBtn) toggleBtn.textContent = '▶';
        }
        
    } catch (error) {
        console.error('Ошибка инициализации сайдбара:', error);
    }
}
// Инициализация боковой панели
async function initSidebar() {
    if (sidebarInitialized) return;
    
    try {
        // Загружаем данные пользователя
        const response = await fetch('/api/user');
        const user = await response.json();
        
        // Обновляем профиль в сайдбаре
        updateSidebarProfile(user);
        
        // Обновляем навигационное меню в зависимости от роли
        updateSidebarNav(user.role);
        
        // Добавляем overlay для мобильных
        addMobileOverlay();
        
        sidebarInitialized = true;
        
        // Проверяем размер экрана при загрузке
        handleResize();
        
    } catch (error) {
        console.error('Ошибка инициализации сайдбара:', error);
    }
}

// Добавление overlay для мобильных
function addMobileOverlay() {
    if (!document.querySelector('.sidebar-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.onclick = closeMobileMenu;
        document.body.appendChild(overlay);
    }
}

// Обработка изменения размера окна
function handleResize() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    if (window.innerWidth > 768) {
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
    }
}

// Обновление профиля в сайдбаре
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

// Обновление навигационного меню
function updateSidebarNav(role) {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    
    let menuItems = [];
    
    // Базовые пункты меню для всех
    menuItems.push({
        icon: '🏠',
        text: 'Главная',
        link: '/dashboard',
        active: window.location.pathname === '/dashboard'
    });
    
    // Пункты меню в зависимости от роли
    switch(role) {
        case 'activist':
            menuItems.push({
                icon: '📊',
                text: 'Мой профиль',
                link: '#',
                onclick: 'showProfile()',
                active: false
            });
            break;
            
        case 'chairman':
            menuItems.push({
                icon: '➕',
                text: 'Создать мероприятие',
                link: '#',
                onclick: 'showCreateEventModal()',
                active: false
            });
            menuItems.push({
                icon: '🏆',
                text: 'Добавить достижение',
                link: '#',
                onclick: 'showCreateAchievementModal()',
                active: false
            });
            break;
            
        case 'specialist':
            menuItems.push({
                icon: '➕',
                text: 'Создать мероприятие',
                link: '#',
                onclick: 'showCreateEventModal()',
                active: false
            });
            menuItems.push({
                icon: '👤',
                text: 'Создать пользователя',
                link: '#',
                onclick: 'showCreateUserModal()',
                active: false
            });
            menuItems.push({
                icon: '👥',
                text: 'Создать команду',
                link: '#',
                onclick: 'showCreateTeamModal()',
                active: false
            });
            menuItems.push({
                icon: '⚠️',
                text: 'Штраф',
                link: '#',
                onclick: 'showPenaltyModal()',
                active: false
            });
            break;
    }
    
    // Пункт выхода для всех
    menuItems.push({
        icon: '🚪',
        text: 'Выход',
        link: '#',
        onclick: 'logout()',
        active: false
    });
    
    // Рендерим меню
    renderSidebarNav(menuItems);
}

// Рендеринг навигационного меню
function renderSidebarNav(items) {
    const nav = document.getElementById('sidebarNav');
    nav.innerHTML = '';
    
    items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'sidebar-nav-item';
        
        const a = document.createElement('a');
        a.className = `sidebar-nav-link ${item.active ? 'active' : ''}`;
        a.href = item.link;
        
        if (item.onclick) {
            a.setAttribute('onclick', item.onclick + '; return false;');
        }
        
        a.innerHTML = `
            <i>${item.icon}</i>
            <span>${item.text}</span>
        `;
        
        li.appendChild(a);
        nav.appendChild(li);
    });
}

// Функция выхода
async function logout() {
    try {
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    } catch (error) {
        console.error('Ошибка при выходе:', error);
    }
}

// Сворачивание/разворачивание боковой панели
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.querySelector('.main-content');
    const toggleBtn = document.querySelector('.sidebar-toggle i');
    
    sidebar.classList.toggle('collapsed');
    mainContent.classList.toggle('expanded');
    
    if (sidebar.classList.contains('collapsed')) {
        toggleBtn.textContent = '▶';
        localStorage.setItem('sidebarCollapsed', 'true');
    } else {
        toggleBtn.textContent = '◀';
        localStorage.setItem('sidebarCollapsed', 'false');
    }
}

// Открытие мобильного меню
function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    sidebar.classList.toggle('mobile-open');
    if (overlay) {
        overlay.classList.toggle('active');
    }
    
    // Блокируем скролл body при открытом меню
    if (sidebar.classList.contains('mobile-open')) {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }
}

// Закрытие мобильного меню
function closeMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    sidebar.classList.remove('mobile-open');
    if (overlay) {
        overlay.classList.remove('active');
    }
    document.body.style.overflow = '';
}

// Получение отображаемого названия роли
function getRoleDisplay(role) {
    const roles = {
        'activist': 'Активист',
        'chairman': 'Председатель',
        'specialist': 'Специалист'
    };
    return roles[role] || role;
}

// Слушаем изменение размера окна
window.addEventListener('resize', function() {
    if (window.innerWidth > 768) {
        closeMobileMenu();
    }
    handleResize();
});

// Инициализация при загрузке страницы
document.addEventListener('click', function(event) {
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.querySelector('.menu-toggle');
    
    if (window.innerWidth <= 768) {
        if (!sidebar.contains(event.target) && !menuToggle.contains(event.target)) {
            sidebar.classList.remove('mobile-open');
        }
    }
});

