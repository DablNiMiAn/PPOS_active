const mysql = require('mysql2/promise');
require('dotenv').config();

async function testConnection() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });
        
        console.log('✅ Подключение к MySQL успешно!');
        
        const [rows] = await connection.execute('SELECT 1 + 1 AS solution');
        console.log('✅ Тестовый запрос выполнен:', rows[0].solution === 2 ? 'OK' : 'Ошибка');
        
        const [teams] = await connection.execute('SELECT * FROM teams');
        console.log('✅ Команды в базе:', teams.length);
        
        await connection.end();
    } catch (error) {
        console.error('❌ Ошибка подключения:', error.message);
    }
}

testConnection();