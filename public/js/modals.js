// ========== МОДАЛЬНЫЕ ОКНА ==========

// Глобальные переменные
window.modalState = {
    teamMembers: [],
    allUsers: [],
    selectedUsers: new Map(),
    currentSearchTab: 'team',
    eventSearchResults: [],
    achievementSearchResults: [],
    eventSelectedUserId: null,
    achievementSelectedUser: null,
    currentUserId: null,
    currentUserTeamId: null,
    selectedPenaltyUserId: null
};

// ==================== ФУНКЦИИ ЗАКРЫТИЯ МОДАЛЬНЫХ ОКОН ====================
window.closeEventModal = function() {
    const modal = document.getElementById('eventModal');
    if (modal) modal.style.display = 'none';
};

window.closeAchievementModal = function() {
    const modal = document.getElementById('achievementModal');
    if (modal) modal.style.display = 'none';
};

window.closeTeamModal = function() {
    const modal = document.getElementById('teamModal');
    if (modal) modal.style.display = 'none';
};

window.closeUserModal = function() {
    const modal = document.getElementById('userModal');
    if (modal) modal.style.display = 'none';
};

window.closePenaltyModal = function() {
    const modal = document.getElementById('penaltyModal');
    if (modal) modal.style.display = 'none';
};

window.closeLogoutModal = function() {
    const modal = document.getElementById('logoutModal');
    if (modal) modal.style.display = 'none';
};

window.closeAllModals = function() {
    window.closeEventModal();
    window.closeAchievementModal();
    window.closeTeamModal();
    window.closeUserModal();
    window.closePenaltyModal();
    window.closeLogoutModal();
};

// ==================== МОДАЛЬНОЕ ОКНО СОЗДАНИЯ МЕРОПРИЯТИЯ ====================
window.showCreateEventModal = function() {
    console.log('showCreateEventModal вызвана');
    const modal = document.getElementById('eventModal');
    if (!modal) {
        console.error('Модальное окно eventModal не найдено');
        return;
    }
    
    modal.style.display = 'block';
    const form = document.getElementById('eventForm');
    if (form) form.reset();
    
    window.modalState.selectedUsers.clear();
    window.updateSelectedUsersList();
    
    const resultsContainer = document.getElementById('userSearchResults');
    if (resultsContainer) {
        resultsContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">Введите минимум 2 символа для поиска</div>';
    }
    
    const countSpan = document.getElementById('searchCount');
    if (countSpan) countSpan.textContent = '0';
    
    const addBtn = document.getElementById('addSelectedBtn');
    if (addBtn) addBtn.disabled = true;
    
    window.modalState.eventSelectedUserId = null;
    window.modalState.currentSearchTab = 'team';
    
    const tabs = document.querySelectorAll('.search-tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (tabs[0]) tabs[0].classList.add('active');
};

window.switchSearchTab = function(tab) {
    window.modalState.currentSearchTab = tab;
    
    const tabs = document.querySelectorAll('.search-tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    
    const searchInput = document.getElementById('userSearch');
    if (searchInput) searchInput.value = '';
    
    const resultsContainer = document.getElementById('userSearchResults');
    if (resultsContainer) {
        resultsContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">Введите минимум 2 символа для поиска</div>';
    }
    
    const countSpan = document.getElementById('searchCount');
    if (countSpan) countSpan.textContent = '0';
    
    const addBtn = document.getElementById('addSelectedBtn');
    if (addBtn) addBtn.disabled = true;
    window.modalState.eventSelectedUserId = null;
};

window.searchEventUsers = function() {
    const searchText = document.getElementById('userSearch')?.value.toLowerCase();
    const resultsContainer = document.getElementById('userSearchResults');
    const countSpan = document.getElementById('searchCount');
    
    if (!searchText || searchText.length < 2) {
        if (resultsContainer) {
            resultsContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">Введите минимум 2 символа для поиска</div>';
        }
        if (countSpan) countSpan.textContent = '0';
        return;
    }
    
    let usersToSearch;
    if (window.modalState.currentSearchTab === 'team') {
        usersToSearch = window.modalState.teamMembers || [];
    } else {
        usersToSearch = window.modalState.allUsers || [];
    }
    
    const filtered = usersToSearch.filter(user => 
        user.full_name && user.full_name.toLowerCase().includes(searchText)
    );
    
    if (countSpan) countSpan.textContent = filtered.length;
    window.displayEventSearchResults(filtered.slice(0, 10));
    window.modalState.eventSearchResults = filtered;
};

window.displayEventSearchResults = function(users) {
    const container = document.getElementById('userSearchResults');
    if (!container) return;
    
    if (users.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Пользователи не найдены</div>';
        return;
    }
    
    container.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-result-item';
        div.onclick = () => window.selectEventUser(user.id, user.full_name, user.team_name);
        div.innerHTML = `
            <div class="user-result-info">
                <div class="user-result-name">${escapeHtml(user.full_name)}</div>
                <div class="user-result-meta">
                    <span class="user-result-team">${user.team_name || 'Без команды'}</span>
                    <span>⭐ ${user.total_rating || 0}</span>
                </div>
            </div>
            <span style="color: #bf5254;">➕</span>
        `;
        container.appendChild(div);
    });
};

window.selectEventUser = function(id, name, team) {
    window.modalState.eventSelectedUserId = id;
    
    const items = document.querySelectorAll('#userSearchResults .user-result-item');
    items.forEach(item => item.classList.remove('selected'));
    if (event && event.currentTarget) event.currentTarget.classList.add('selected');
    
    const addBtn = document.getElementById('addSelectedBtn');
    if (addBtn) addBtn.disabled = false;
};

window.addSelectedUser = function() {
    if (!window.modalState.eventSelectedUserId) return;
    
    if (window.modalState.selectedUsers.has(window.modalState.eventSelectedUserId)) {
        alert('Этот пользователь уже добавлен');
        return;
    }
    
    const user = window.modalState.eventSearchResults.find(u => u.id === window.modalState.eventSelectedUserId);
    if (!user) return;
    
    window.modalState.selectedUsers.set(window.modalState.eventSelectedUserId, {
        id: user.id,
        name: user.full_name,
        team: user.team_name,
        role: 'volunteer'
    });
    
    window.updateSelectedUsersList();
    
    const addBtn = document.getElementById('addSelectedBtn');
    if (addBtn) addBtn.disabled = true;
    window.modalState.eventSelectedUserId = null;
    
    const items = document.querySelectorAll('#userSearchResults .user-result-item');
    items.forEach(item => item.classList.remove('selected'));
};

window.updateSelectedUsersList = function() {
    const container = document.getElementById('selectedUsersList');
    const countSpan = document.getElementById('selectedCount');
    
    if (!container) return;
    
    if (countSpan) countSpan.textContent = window.modalState.selectedUsers.size;
    
    if (window.modalState.selectedUsers.size === 0) {
        container.innerHTML = '<p style="color: #666; text-align: center; padding: 10px;">Нет выбранных участников</p>';
        return;
    }
    
    container.innerHTML = '';
    
    window.modalState.selectedUsers.forEach((user, userId) => {
        const div = document.createElement('div');
        div.className = 'selected-user-item';
        div.innerHTML = `
            <div style="flex: 1;">
                <strong>${escapeHtml(user.name)}</strong>
                <div style="font-size: 0.85rem; color: #666;">${user.team || 'Без команды'}</div>
            </div>
            <select class="selected-user-role" onchange="window.updateUserRole(${userId}, this.value)">
                <option value="volunteer" ${user.role === 'volunteer' ? 'selected' : ''}>Волонтер (1)</option>
                <option value="media" ${user.role === 'media' ? 'selected' : ''}>Медиа (2)</option>
                <option value="organizer" ${user.role === 'organizer' ? 'selected' : ''}>Организатор (3)</option>
            </select>
            <button type="button" class="remove-user-btn" onclick="window.removeUserFromSelection(${userId})">✕</button>
        `;
        container.appendChild(div);
    });
};

window.updateUserRole = function(userId, role) {
    if (window.modalState.selectedUsers.has(userId)) {
        const user = window.modalState.selectedUsers.get(userId);
        user.role = role;
        window.modalState.selectedUsers.set(userId, user);
    }
};

window.removeUserFromSelection = function(userId) {
    window.modalState.selectedUsers.delete(userId);
    window.updateSelectedUsersList();
};

window.quickAddParticipant = function(userId, userName) {
    if (!window.modalState.selectedUsers.has(userId)) {
        window.modalState.selectedUsers.set(userId, {
            id: userId,
            name: userName,
            role: 'volunteer'
        });
        window.updateSelectedUsersList();
    }
    window.showCreateEventModal();
};

// ==================== МОДАЛЬНОЕ ОКНО ДОСТИЖЕНИЙ ====================
window.showCreateAchievementModal = function() {
    console.log('showCreateAchievementModal вызвана');
    const modal = document.getElementById('achievementModal');
    if (!modal) {
        console.error('Модальное окно achievementModal не найдено');
        return;
    }
    
    modal.style.display = 'block';
    const form = document.getElementById('achievementForm');
    if (form) form.reset();
    
    window.modalState.achievementSelectedUser = null;
    window.updateAchievementSelectedUsersList();
    
    const resultsContainer = document.getElementById('achievementUserResults');
    if (resultsContainer) {
        resultsContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">Введите минимум 2 символа для поиска</div>';
    }
    
    const countSpan = document.getElementById('achievementSearchCount');
    if (countSpan) countSpan.textContent = '0';
};

window.showAddAchievementModal = function() {
    window.showCreateAchievementModal();
};

window.searchAchievementUsers = function() {
    const searchText = document.getElementById('achievementUserSearch')?.value.toLowerCase();
    const resultsContainer = document.getElementById('achievementUserResults');
    const countSpan = document.getElementById('achievementSearchCount');
    
    if (!searchText || searchText.length < 2) {
        if (resultsContainer) {
            resultsContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">Введите минимум 2 символа для поиска</div>';
        }
        if (countSpan) countSpan.textContent = '0';
        return;
    }
    
    const activists = (window.modalState.allUsers || []).filter(user => 
        user.role === 'activist' || user.role === 'chairman'
    );
    const filtered = activists.filter(user => 
        user.full_name && user.full_name.toLowerCase().includes(searchText)
    );
    
    if (countSpan) countSpan.textContent = filtered.length;
    window.displayAchievementSearchResults(filtered.slice(0, 10));
    window.modalState.achievementSearchResults = filtered;
};

window.displayAchievementSearchResults = function(users) {
    const container = document.getElementById('achievementUserResults');
    if (!container) return;
    
    if (users.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Активисты не найдены</div>';
        return;
    }
    
    container.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-result-item';
        div.onclick = () => window.selectAchievementUser(user);
        div.innerHTML = `
            <div class="user-result-info">
                <div class="user-result-name">${escapeHtml(user.full_name)}</div>
                <div class="user-result-meta">
                    <span class="user-result-team">${user.team_name || 'Без команды'}</span>
                    <span>⭐ ${user.total_rating || 0}</span>
                </div>
            </div>
            <span style="color: #bf5254;">➕</span>
        `;
        container.appendChild(div);
    });
};

window.selectAchievementUser = function(user) {
    window.modalState.achievementSelectedUser = {
        id: user.id,
        name: user.full_name,
        team: user.team_name
    };
    
    const items = document.querySelectorAll('#achievementUserResults .user-result-item');
    items.forEach(item => item.style.background = 'white');
    if (event && event.currentTarget) event.currentTarget.style.background = '#f0f0f0';
    
    window.updateAchievementSelectedUsersList();
};

window.updateAchievementSelectedUsersList = function() {
    const container = document.getElementById('achievementSelectedUsersList');
    const countSpan = document.getElementById('achievementSelectedCount');
    
    if (!container) return;
    
    if (!window.modalState.achievementSelectedUser) {
        if (countSpan) countSpan.textContent = '0';
        container.innerHTML = '<p style="color: #666; text-align: center; padding: 10px;">Активист не выбран</p>';
        return;
    }
    
    if (countSpan) countSpan.textContent = '1';
    container.innerHTML = '';
    
    const div = document.createElement('div');
    div.className = 'selected-user-item';
    div.innerHTML = `
        <div style="flex: 1;">
            <strong>${escapeHtml(window.modalState.achievementSelectedUser.name)}</strong>
            <div style="font-size: 0.85rem; color: #666;">${window.modalState.achievementSelectedUser.team || 'Без команды'}</div>
        </div>
        <button type="button" onclick="window.clearAchievementSelectedUser()" style="background: #f56565; color: white; border: none; border-radius: 3px; padding: 3px 8px; cursor: pointer;">✕</button>
    `;
    container.appendChild(div);
};

window.clearAchievementSelectedUser = function() {
    window.modalState.achievementSelectedUser = null;
    window.updateAchievementSelectedUsersList();
};

// ==================== МОДАЛЬНОЕ ОКНО КОМАНДЫ ====================
window.showCreateTeamModal = function() {
    console.log('showCreateTeamModal вызвана');
    const modal = document.getElementById('teamModal');
    if (modal) {
        modal.style.display = 'block';
        const form = document.getElementById('teamForm');
        if (form) form.reset();
    } else {
        console.error('Модальное окно teamModal не найдено');
    }
};

// ==================== МОДАЛЬНОЕ ОКНО ПОЛЬЗОВАТЕЛЯ ====================
window.showCreateUserModal = function() {
    console.log('showCreateUserModal вызвана');
    const modal = document.getElementById('userModal');
    if (modal) {
        modal.style.display = 'block';
        const form = document.getElementById('userForm');
        if (form) form.reset();
        window.loadTeamsIntoSelect();
    } else {
        console.error('Модальное окно userModal не найдено');
    }
};

window.loadTeamsIntoSelect = async function() {
    const teamSelect = document.getElementById('team_id');
    if (!teamSelect) return;
    
    const teams = await apiGet('/api/teams');
    if (teams) {
        teamSelect.innerHTML = '<option value="">Выберите команду</option>';
        teams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            teamSelect.appendChild(option);
        });
    }
};

// ==================== МОДАЛЬНОЕ ОКНО ШТРАФА ====================
let penaltyUsersList = [];

window.showPenaltyModal = function() {
    console.log('showPenaltyModal вызвана');
    const modal = document.getElementById('penaltyModal');
    if (modal) {
        modal.style.display = 'block';
        const form = document.getElementById('penaltyForm');
        if (form) form.reset();
        
        const searchInput = document.getElementById('penaltyUserSearch');
        if (searchInput) searchInput.value = '';
        
        window.renderPenaltyUsers(penaltyUsersList);
    } else {
        console.error('Модальное окно penaltyModal не найдено');
    }
};

window.renderPenaltyUsers = function(users) {
    const container = document.getElementById('penaltyUserList');
    const countSpan = document.getElementById('penaltyUsersCount');
    
    if (!container) return;
    
    container.innerHTML = '';
    if (countSpan) countSpan.textContent = users.length;
    
    if (users.length === 0) {
        container.innerHTML = '<div style="padding:10px;text-align:center;color:#666;">Не найдено</div>';
        return;
    }
    
    users.forEach(user => {
        const div = document.createElement('div');
        div.style.cssText = 'padding: 10px; border-bottom: 1px solid #eee; cursor: pointer;';
        div.innerHTML = `
            <strong>${escapeHtml(user.full_name)}</strong>
            <div style="font-size:12px;color:#666;">
                ${user.role === 'activist' ? 'Активист' : 'Председатель'} | рейтинг: ${user.total_rating}
            </div>
        `;
        div.onclick = () => window.selectPenaltyUser(user, div);
        container.appendChild(div);
    });
};

window.selectPenaltyUser = function(user, element) {
    window.modalState.selectedPenaltyUserId = user.id;
    
    const hiddenInput = document.getElementById('penaltyUser');
    if (hiddenInput) hiddenInput.value = user.id;
    
    const items = document.querySelectorAll('#penaltyUserList div');
    items.forEach(el => el.style.background = 'white');
    element.style.background = '#f0f0f0';
};

window.searchPenaltyUsers = function() {
    const search = document.getElementById('penaltyUserSearch')?.value.toLowerCase();
    
    if (!search) {
        window.renderPenaltyUsers(penaltyUsersList);
        return;
    }
    
    const filtered = penaltyUsersList.filter(user =>
        user.full_name.toLowerCase().includes(search)
    );
    window.renderPenaltyUsers(filtered);
};

// ==================== ПАНЕЛЬ ПОДСКАЗОК ====================
window.toggleHintPanel = function() {
    const panel = document.getElementById('hintPanel');
    if (!panel) return;
    
    if (panel.style.width === '0px' || panel.style.width === '') {
        panel.style.width = '300px';
    } else {
        panel.style.width = '0px';
    }
};

// ==================== ВЫХОД ИЗ СИСТЕМЫ ====================
window.showLogoutConfirm = function() {
    const modal = document.getElementById('logoutModal');
    if (modal) {
        modal.style.display = 'block';
    } else {
        window.confirmLogout();
    }
};

window.confirmLogout = async function() {
    try {
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    } catch (error) {
        console.error('Ошибка при выходе:', error);
        alert('Произошла ошибка при выходе');
    }
};

window.logout = function() {
    window.showLogoutConfirm();
};

// ==================== ЗАГРУЗКА ДАННЫХ ДЛЯ МОДАЛЬНЫХ ОКОН ====================
window.loadUsersForModals = async function() {
    try {
        const response = await fetch('/chairman/all-users');
        window.modalState.allUsers = await response.json();
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
        window.modalState.allUsers = [];
    }
};

window.loadTeamMembersForModals = async function() {
    try {
        const response = await fetch('/chairman/team-members');
        window.modalState.teamMembers = await response.json();
    } catch (error) {
        console.error('Ошибка загрузки участников команды:', error);
        window.modalState.teamMembers = [];
    }
};

window.loadPenaltyUsers = async function() {
    try {
        const response = await fetch('/specialist/users');
        const users = await response.json();
        penaltyUsersList = users.filter(u => u.role === 'activist' || u.role === 'chairman');
    } catch (error) {
        console.error('Ошибка загрузки пользователей для штрафов:', error);
        penaltyUsersList = [];
    }
};

// ==================== ПРОФИЛЬ ====================
window.showProfile = function() {
    const userId = window.sidebarUser?.id;
    const role = window.sidebarUser?.role;
    if (userId && role) {
        window.location.href = `/profile.html?id=${userId}&role=${role}`;
    }
};