const express = require('express');
const app = express();

console.log('Загрузка роутов...');

// Загружаем роуты без базы данных
const authRoutes = require('./routes/auth')({ get: () => null });
const activistRoutes = require('./routes/activist')({ get: () => null });
const chairmanRoutes = require('./routes/chairman')({ get: () => null });
const specialistRoutes = require('./routes/specialist')({ get: () => null });

console.log('✅ Роуты загружены');

// Функция для вывода маршрутов роутера
function printRouterRoutes(router, prefix = '') {
    if (!router || !router.stack) {
        console.log(`  ${prefix}: нет маршрутов или роутер не инициализирован`);
        return;
    }
    
    router.stack.forEach(layer => {
        if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
            console.log(`  ${methods} ${prefix}${layer.route.path}`);
        } else if (layer.name === 'router' && layer.handle.stack) {
            console.log(`\n  Вложенный роутер:`);
            printRouterRoutes(layer.handle, prefix);
        }
    });
}

// Проверяем каждый роутер
console.log('\n=== МАРШРУТЫ AUTH ===');
printRouterRoutes(authRoutes, '/auth');

console.log('\n=== МАРШРУТЫ ACTIVIST ===');
printRouterRoutes(activistRoutes, '/activist');

console.log('\n=== МАРШРУТЫ CHAIRMAN ===');
printRouterRoutes(chairmanRoutes, '/chairman');

console.log('\n=== МАРШРУТЫ SPECIALIST ===');
printRouterRoutes(specialistRoutes, '/specialist');

// Особое внимание на DELETE маршруты в specialist
console.log('\n=== ПОИСК DELETE МАРШРУТОВ В SPECIALIST ===');
if (specialistRoutes && specialistRoutes.stack) {
    let foundDelete = false;
    specialistRoutes.stack.forEach(layer => {
        if (layer.route && layer.route.methods && layer.route.methods.delete) {
            console.log(`✅ Найден DELETE маршрут: ${layer.route.path}`);
            foundDelete = true;
        }
    });
    if (!foundDelete) {
        console.log('❌ DELETE маршруты не найдены!');
        
        // Покажем все маршруты specialist для отладки
        console.log('\nВсе маршруты specialist:');
        specialistRoutes.stack.forEach((layer, i) => {
            if (layer.route) {
                console.log(`  [${i}] ${Object.keys(layer.route.methods)} ${layer.route.path}`);
            }
        });
    }
} else {
    console.log('❌ specialistRoutes не инициализирован или не имеет stack');
}