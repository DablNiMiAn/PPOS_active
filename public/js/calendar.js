// ========== КАЛЕНДАРЬ МЕРОПРИЯТИЙ ==========

let calendar;
let currentUser = null;
let currentEventId = null;
let selectedDate = null;
let allTeams = [];
let allEvents = [];

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔄 Инициализация календаря...');
    
    try {
        await loadCurrentUser();
        await loadTeams();
        initCalendar();
        await loadEvents();
        
        console.log('✅ Календарь инициализирован');
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
    }
});

// Загрузка текущего пользователя
async function loadCurrentUser() {
    const response = await fetch('/api/user');
    if (!response.ok) {
        window.location.href = '/login';
        return;
    }
    currentUser = await response.json();
    
    // Обновляем сайдбар
    if (typeof updateSidebarProfile === 'function') {
        updateSidebarProfile(currentUser);
    }
    
    console.log('👤 Текущий пользователь:', currentUser);
}

// Загрузка списка команд
async function loadTeams() {
    try {
        const response = await fetch('/api/teams');
        allTeams = await response.json();
        
        // Заполняем фильтр команд
        const filter = document.getElementById('teamFilter');
        filter.innerHTML = '<option value="all">Все команды</option>';
        
        // Заполняем селект в модальном окне в зависимости от роли
        updateTeamSelect();
        
        allTeams.forEach(team => {
            // Для фильтра
            const filterOption = document.createElement('option');
            filterOption.value = team.id;
            filterOption.textContent = team.name;
            filter.appendChild(filterOption);
        });
        
    } catch (error) {
        console.error('❌ Ошибка загрузки команд:', error);
    }
}

// Обновление селекта команды в зависимости от роли
function updateTeamSelect() {
    const teamSelect = document.getElementById('eventTeam');
    if (!teamSelect || !currentUser) return;
    
    teamSelect.innerHTML = '<option value="">Выберите команду</option>';
    
    switch (currentUser.role) {
        case 'specialist':
            // Специалист может выбирать любую команду
            const publicOption = document.createElement('option');
            publicOption.value = 'public';
            publicOption.textContent = 'Общее мероприятие';
            teamSelect.appendChild(publicOption);
            
            allTeams.forEach(team => {
                const option = document.createElement('option');
                option.value = team.id;
                option.textContent = team.name;
                teamSelect.appendChild(option);
            });
            break;
            
        case 'chairman':
            // Председатель может выбирать только свою команду
            if (currentUser.team_id) {
                const team = allTeams.find(t => t.id === currentUser.team_id);
                if (team) {
                    const option = document.createElement('option');
                    option.value = team.id;
                    option.textContent = team.name;
                    option.selected = true;
                    teamSelect.appendChild(option);
                }
            } else {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'Нет команды (обратитесь к специалисту)';
                option.disabled = true;
                option.selected = true;
                teamSelect.appendChild(option);
            }
            // Делаем селект readonly для председателя
            teamSelect.disabled = true;
            break;
            
        case 'activist':
            // Активист не может создавать события, скрываем селект
            teamSelect.disabled = true;
            teamSelect.style.display = 'none';
            document.querySelector('.form-group:has(#eventTeam)').style.display = 'none';
            break;
    }
}

// Инициализация FullCalendar
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ru',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        buttonText: {
            today: 'Сегодня',
            month: 'Месяц',
            week: 'Неделя',
            day: 'День'
        },
        events: [],
        eventClick: function(info) {
            showEventDetails(info.event);
        },
        dateClick: function(info) {
            // Проверяем права на создание события
            if (canCreateEvent()) {
                selectedDate = info.date;
                showCreateEventModal(info.date);
            }
        },
        eventDidMount: function(info) {
            // Добавляем класс для цвета команды
            const teamId = info.event.extendedProps.teamId;
            if (teamId === 'public') {
                info.el.classList.add('team-public');
            } else if (teamId) {
                // Используем номер команды для цвета (ограничиваем 5)
                const teamNumber = (teamId % 5) + 1;
                info.el.classList.add(`team-${teamNumber}`);
            }
        }
    });
    
    calendar.render();
    
    // Скрываем кнопку создания для активиста
    if (!canCreateEvent()) {
        document.querySelector('.calendar-controls .btn').style.display = 'none';
    }
}

// Проверка прав на создание события
function canCreateEvent() {
    if (!currentUser) return false;
    return currentUser.role === 'chairman' || currentUser.role === 'specialist';
}

// Проверка прав на редактирование события
function canEditEvent(event) {
    if (!currentUser || !event) return false;
    
    // Специалист может редактировать всё
    if (currentUser.role === 'specialist') return true;
    
    // Председатель может редактировать только события своей команды
    if (currentUser.role === 'chairman') {
        const eventTeamId = event.extendedProps?.teamId;
        return eventTeamId === currentUser.team_id;
    }
    
    return false;
}

// Загрузка событий
async function loadEvents() {
    const status = document.getElementById('status');
    status.innerHTML = '⏳ Загрузка...';
    
    try {
        const response = await fetch('/api/calendar-fixed');
        
        if (!response.ok) {
            throw new Error(`HTTP ошибка: ${response.status}`);
        }
        
        allEvents = await response.json();
        console.log('📅 Загружены события:', allEvents);
        
        status.innerHTML = `✅ Загружено событий: ${allEvents.length}`;
        
        // Применяем фильтр
        filterEvents();
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        status.innerHTML = `❌ Ошибка загрузки`;
    }
}

// Фильтрация событий
function filterEvents() {
    const filterValue = document.getElementById('teamFilter').value;
    console.log('🔍 Фильтр:', filterValue);
    
    let filteredEvents = allEvents;
    
    if (filterValue !== 'all') {
        if (filterValue === 'public') {
            filteredEvents = allEvents.filter(event => {
                const teamId = event.extendedProps?.teamId;
                return teamId === 'public' || teamId === null;
            });
        } else {
            const teamId = parseInt(filterValue);
            filteredEvents = allEvents.filter(event => {
                const eventTeamId = event.extendedProps?.teamId;
                return eventTeamId === teamId;
            });
        }
    }
    
    console.log('📊 Отфильтрованные события:', filteredEvents.length);
    
    calendar.removeAllEvents();
    if (filteredEvents.length > 0) {
        calendar.addEventSource(filteredEvents);
    }
}

// Показать модальное окно создания события
function showCreateEventModal(date) {
    // Дополнительная проверка прав
    if (!canCreateEvent()) {
        alert('У вас нет прав для создания мероприятий');
        return;
    }
    
    const modal = document.getElementById('eventModal');
    const titleEl = document.getElementById('modalTitle');
    
    titleEl.textContent = 'Создание мероприятия';
    document.getElementById('eventForm').reset();
    
    // Устанавливаем дату
    if (date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        document.getElementById('eventDate').value = `${year}-${month}-${day}`;
    }
    
    // Для председателя автоматически выбираем его команду
    if (currentUser.role === 'chairman' && currentUser.team_id) {
        document.getElementById('eventTeam').value = currentUser.team_id;
    }
    
    currentEventId = null;
    modal.style.display = 'block';
}

// Сохранение события
async function saveEvent() {
    // Проверка прав
    if (!canCreateEvent()) {
        alert('У вас нет прав для создания мероприятий');
        return;
    }
    
    const title = document.getElementById('eventTitle').value.trim();
    const description = document.getElementById('eventDescription').value.trim();
    const date = document.getElementById('eventDate').value;
    const time = document.getElementById('eventTime').value;
    const location = document.getElementById('eventLocation').value.trim();
    const teamId = document.getElementById('eventTeam').value;
    
    if (!title || !date || !time) {
        alert('Заполните название, дату и время');
        return;
    }
    
    // Для председателя проверяем, что событие создается для его команды
    if (currentUser.role === 'chairman') {
        if (!currentUser.team_id) {
            alert('Вы не привязаны к команде');
            return;
        }
        if (teamId && teamId !== '' && parseInt(teamId) !== currentUser.team_id) {
            alert('Вы можете создавать мероприятия только для своей команды');
            return;
        }
    }
    
    const eventData = {
        title: title,
        description: description,
        event_date: date,
        start_time: time,
        end_time: time,
        location: location,
        team_id: teamId === 'public' ? null : teamId || null
    };
    
    console.log('📤 Отправка данных:', eventData);
    
    try {
        const response = await fetch('/api/calendar/events', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventData)
        });
        
        if (response.ok) {
            alert('✅ Мероприятие создано');
            closeEventModal();
            await loadEvents();
        } else {
            const error = await response.json();
            alert(`❌ Ошибка: ${error.error}`);
        }
        
    } catch (error) {
        alert(`❌ Ошибка: ${error.message}`);
    }
}

// Показать детали события
function showEventDetails(event) {
    const modal = document.getElementById('eventDetailsModal');
    const details = document.getElementById('eventDetails');
    
    const start = event.start ? event.start.toLocaleString() : '';
    const location = event.extendedProps?.location || 'Не указано';
    const teamName = event.extendedProps?.teamName || 'Не указана';
    
    // Проверяем права на редактирование
    const canEdit = canEditEvent(event);
    
    details.innerHTML = `
        <p><strong>📌 Название:</strong> ${event.title}</p>
        <p><strong>📅 Дата и время:</strong> ${start}</p>
        <p><strong>📍 Место:</strong> ${location}</p>
        <p><strong>👥 Команда:</strong> ${teamName}</p>
        <p><strong>📝 Описание:</strong> ${event.extendedProps?.description || 'Нет описания'}</p>
    `;
    
    // Показываем кнопки редактирования/удаления если есть права
    const footer = document.querySelector('#eventDetailsModal .modal-footer');
    if (canEdit) {
        footer.innerHTML = `
            <button class="btn btn-secondary" onclick="editEvent(${event.id})">✏️ Редактировать</button>
            <button class="btn" style="background: #dc3545;" onclick="deleteEvent(${event.id})">🗑️ Удалить</button>
            <button class="btn" onclick="closeDetailsModal()">Закрыть</button>
        `;
    } else {
        footer.innerHTML = `<button class="btn" onclick="closeDetailsModal()">Закрыть</button>`;
    }
    
    modal.style.display = 'block';
}

// Редактирование события
async function editEvent(eventId) {
    // Здесь можно добавить логику редактирования
    closeDetailsModal();
    // Пока просто показываем сообщение
    alert('Функция редактирования будет добавлена позже');
}

// Удаление события
async function deleteEvent(eventId) {
    if (!confirm('Вы уверены, что хотите удалить это мероприятие?')) return;
    
    try {
        const response = await fetch(`/api/calendar/events/${eventId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            alert('✅ Мероприятие удалено');
            closeDetailsModal();
            await loadEvents();
        } else {
            const error = await response.json();
            alert(`❌ Ошибка: ${error.error}`);
        }
        
    } catch (error) {
        alert(`❌ Ошибка: ${error.message}`);
    }
}

// Закрытие модальных окон
function closeEventModal() {
    document.getElementById('eventModal').style.display = 'none';
}

function closeDetailsModal() {
    document.getElementById('eventDetailsModal').style.display = 'none';
}

// Закрытие модальных окон по клику вне их
window.addEventListener('click', (event) => {
    const eventModal = document.getElementById('eventModal');
    const detailsModal = document.getElementById('eventDetailsModal');
    
    if (event.target === eventModal) {
        closeEventModal();
    }
    if (event.target === detailsModal) {
        closeDetailsModal();
    }
});

// Выход
async function logout() {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/login';
}