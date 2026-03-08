// public/js/table-utils.js

/**
 * Универсальный класс для работы с таблицами с пагинацией, фильтрацией и поиском
 */
class DataTable {
    constructor(options) {
        this.tableId = options.tableId;
        this.dataUrl = options.dataUrl;
        this.columns = options.columns;
        this.itemsPerPage = options.itemsPerPage || 10;
        this.searchableFields = options.searchableFields || [];
        this.filterableFields = options.filterableFields || [];
        this.onRowClick = options.onRowClick || null;
        this.actions = options.actions || null;
        
        this.currentPage = 1;
        this.allData = [];
        this.filteredData = [];
        this.searchTerm = '';
        this.filters = {};
        
        this.init();
    }
    
    async init() {
        await this.loadData();
        this.renderFilters();
        this.render();
    }
    
    async loadData() {
        try {
            const response = await fetch(this.dataUrl);
            this.allData = await response.json();
            this.filteredData = [...this.allData];
            this.updateStats();
        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
        }
    }
    
    applyFilters() {
        this.filteredData = this.allData.filter(item => {
            // Поиск по тексту
            if (this.searchTerm) {
                const matchesSearch = this.searchableFields.some(field => {
                    const value = this.getNestedValue(item, field);
                    return value && value.toString().toLowerCase().includes(this.searchTerm.toLowerCase());
                });
                if (!matchesSearch) return false;
            }
            
            // Фильтры по полям
            for (const [field, value] of Object.entries(this.filters)) {
                if (value) {
                    const itemValue = this.getNestedValue(item, field);
                    if (itemValue != value) return false;
                }
            }
            
            return true;
        });
        
        this.currentPage = 1;
        this.render();
        this.updateStats();
    }
    
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => current && current[key], obj);
    }
    
    updateStats() {
        const statsEl = document.getElementById(`${this.tableId}-stats`);
        if (statsEl) {
            statsEl.innerHTML = `Показано ${this.getStartIndex() + 1}-${Math.min(this.getEndIndex(), this.filteredData.length)} из ${this.filteredData.length}`;
        }
    }
    
    getStartIndex() {
        return (this.currentPage - 1) * this.itemsPerPage;
    }
    
    getEndIndex() {
        return Math.min(this.currentPage * this.itemsPerPage, this.filteredData.length);
    }
    
    getCurrentPageData() {
        const start = this.getStartIndex();
        const end = this.getEndIndex();
        return this.filteredData.slice(start, end);
    }
    
    // В методе renderFilters добавьте обработку разных типов фильтров
renderFilters() {
    const container = document.getElementById(`${this.tableId}-filters`);
    if (!container) return;
    
    let html = '<div class="filters-container">';
    
    // Поиск
    html += `
        <div class="search-box">
            <input type="text" 
                   id="${this.tableId}-search" 
                   placeholder="Поиск..." 
                   oninput="window.tables['${this.tableId}'].handleSearch(this.value)">
            <span class="search-icon">🔍</span>
        </div>
    `;
    
    // Фильтры
    if (this.filterableFields.length > 0) {
        html += '<div class="filter-selects">';
        this.filterableFields.forEach(field => {
            if (field.type === 'date') {
                // Фильтр по дате
                html += `
                    <div class="filter-group">
                        <label>${field.label}:</label>
                        <input type="date" 
                               onchange="window.tables['${this.tableId}'].handleDateFilter('${field.field}', this.value)">
                    </div>
                `;
            } else if (field.type === 'range') {
                // Фильтр по диапазону
                html += `
                    <div class="filter-group">
                        <label>${field.label}:</label>
                        <input type="number" 
                               placeholder="От" 
                               onchange="window.tables['${this.tableId}'].handleRangeFilter('${field.field}', 'min', this.value)">
                        <input type="number" 
                               placeholder="До" 
                               onchange="window.tables['${this.tableId}'].handleRangeFilter('${field.field}', 'max', this.value)">
                    </div>
                `;
            } else {
                // Обычный селект
                const uniqueValues = [...new Set(this.allData.map(item => this.getNestedValue(item, field.field)))]
                    .filter(v => v != null);
                
                html += `
                    <select onchange="window.tables['${this.tableId}'].handleFilter('${field.field}', this.value)">
                        <option value="">${field.label}</option>
                        ${uniqueValues.map(value => `
                            <option value="${value}">${value}</option>
                        `).join('')}
                    </select>
                `;
            }
        });
        html += '</div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
}

// Новые методы для обработки фильтров
handleDateFilter(field, value) {
    if (value) {
        this.filters[field] = (itemValue) => {
            const itemDate = new Date(itemValue).toISOString().split('T')[0];
            return itemDate === value;
        };
    } else {
        delete this.filters[field];
    }
    this.applyFilters();
}

handleRangeFilter(field, type, value) {
    if (!this.filters[field]) {
        this.filters[field] = {};
    }
    
    if (value) {
        this.filters[field][type] = parseInt(value);
    } else {
        delete this.filters[field][type];
    }
    
    if (Object.keys(this.filters[field]).length === 0) {
        delete this.filters[field];
    }
    
    this.applyFilters();
}

// Обновите метод applyFilters для поддержки новых типов фильтров
applyFilters() {
    this.filteredData = this.allData.filter(item => {
        // Поиск по тексту
        if (this.searchTerm) {
            const matchesSearch = this.searchableFields.some(field => {
                const value = this.getNestedValue(item, field);
                return value && value.toString().toLowerCase().includes(this.searchTerm.toLowerCase());
            });
            if (!matchesSearch) return false;
        }
        
        // Фильтры по полям
        for (const [field, condition] of Object.entries(this.filters)) {
            const itemValue = this.getNestedValue(item, field);
            
            if (typeof condition === 'function') {
                // Функция-фильтр (для дат)
                if (!condition(itemValue)) return false;
            } else if (typeof condition === 'object') {
                // Диапазон
                if (condition.min !== undefined && itemValue < condition.min) return false;
                if (condition.max !== undefined && itemValue > condition.max) return false;
            } else {
                // Точное совпадение
                if (itemValue != condition) return false;
            }
        }
        
        return true;
    });
    
    this.currentPage = 1;
    this.render();
    this.updateStats();
}
    
    handleSearch(term) {
        this.searchTerm = term;
        this.applyFilters();
    }
    
    handleFilter(field, value) {
        if (value) {
            this.filters[field] = value;
        } else {
            delete this.filters[field];
        }
        this.applyFilters();
    }
    
    render() {
        const tbody = document.getElementById(this.tableId);
        if (!tbody) return;
        
        const data = this.getCurrentPageData();
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${this.columns.length + (this.actions ? 1 : 0)}" class="no-data">Нет данных</td></tr>`;
            this.renderPagination();
            this.updateStats();
            return;
        }
        
        tbody.innerHTML = data.map((item, index) => {
            let row = '<tr';
            if (this.onRowClick) {
                row += ` onclick="window.tables['${this.tableId}'].handleRowClick(${item.id})" style="cursor: pointer;"`;
            }
            row += '>';
            
            this.columns.forEach(col => {
                let value = this.getNestedValue(item, col.field);
                if (col.format) {
                    value = col.format(value, item);
                }
                row += `<td>${value || '—'}</td>`;
            });
            
            if (this.actions) {
                row += '<td class="actions">';
                this.actions.forEach(action => {
                    row += `<button class="btn btn-${action.type || 'primary'} btn-small" 
                                   onclick="event.stopPropagation(); window.tables['${this.tableId}'].handleAction('${action.name}', ${item.id})">
                            ${action.label}
                           </button>`;
                });
                row += '</td>';
            }
            
            row += '</tr>';
            return row;
        }).join('');
        
        this.renderPagination();
        this.updateStats();
    }
    
    renderPagination() {
        const container = document.getElementById(`${this.tableId}-pagination`);
        if (!container) return;
        
        const totalPages = Math.ceil(this.filteredData.length / this.itemsPerPage);
        
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        let html = '<div class="pagination">';
        
        // Кнопка "Предыдущая"
        html += `<button class="page-btn" onclick="window.tables['${this.tableId}'].changePage(${this.currentPage - 1})" 
                        ${this.currentPage === 1 ? 'disabled' : ''}>←</button>`;
        
        // Номера страниц
        const startPage = Math.max(1, this.currentPage - 2);
        const endPage = Math.min(totalPages, this.currentPage + 2);
        
        if (startPage > 1) {
            html += `<button class="page-btn" onclick="window.tables['${this.tableId}'].changePage(1)">1</button>`;
            if (startPage > 2) html += '<span class="page-dots">...</span>';
        }
        
        for (let i = startPage; i <= endPage; i++) {
            html += `<button class="page-btn ${i === this.currentPage ? 'active' : ''}" 
                            onclick="window.tables['${this.tableId}'].changePage(${i})">${i}</button>`;
        }
        
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += '<span class="page-dots">...</span>';
            html += `<button class="page-btn" onclick="window.tables['${this.tableId}'].changePage(${totalPages})">${totalPages}</button>`;
        }
        
        // Кнопка "Следующая"
        html += `<button class="page-btn" onclick="window.tables['${this.tableId}'].changePage(${this.currentPage + 1})" 
                        ${this.currentPage === totalPages ? 'disabled' : ''}>→</button>`;
        
        html += '</div>';
        container.innerHTML = html;
    }
    
    changePage(page) {
        this.currentPage = page;
        this.render();
    }
    
    handleRowClick(id) {
        if (this.onRowClick) {
            this.onRowClick(id);
        }
    }
    
    handleAction(actionName, id) {
        if (this.actions) {
            const action = this.actions.find(a => a.name === actionName);
            if (action && action.handler) {
                action.handler(id);
            }
        }
    }
}

// Глобальный объект для хранения таблиц
window.tables = {};