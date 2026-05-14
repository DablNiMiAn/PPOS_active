// loadModals.js - загрузка модальных окон из отдельного файла

let modalsLoaded = false;

async function loadModals() {
    if (modalsLoaded) return;
    
    try {
        const response = await fetch('/views/modals.html');
        const html = await response.text();
        
        // Создаем временный контейнер и вставляем HTML
        const temp = document.createElement('div');
        temp.innerHTML = html;
        
        // Переносим все элементы с class="modal" в body
        const modals = temp.querySelectorAll('.modal');
        modals.forEach(modal => {
            document.body.appendChild(modal);
        });
        
        // Также добавляем стили, если они есть
        const styles = temp.querySelectorAll('style');
        styles.forEach(style => {
            document.head.appendChild(style);
        });
        
        modalsLoaded = true;
        console.log('✅ Модальные окна загружены');
        
    } catch (error) {
        console.error('❌ Ошибка загрузки модальных окон:', error);
    }
}

// Автоматическая загрузка при загрузке страницы
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadModals);
} else {
    loadModals();
}