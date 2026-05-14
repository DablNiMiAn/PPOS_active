// routes/shop.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');


// Middleware для проверки токена
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
};

// Middleware для проверки прав специалиста
const authenticateSpecialist = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        if (user.role !== 'specialist') {
            return res.status(403).json({ error: 'Требуются права специалиста' });
        }
        req.user = user;
        next();
    });
};

// Настройка multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadDir;
        if (file.fieldname === 'images') {
            uploadDir = path.join(__dirname, '../public/uploads/products');
        } else if (file.fieldname && file.fieldname.startsWith('color_image_')) {
            uploadDir = path.join(__dirname, '../public/uploads/colors');
        } else {
            uploadDir = path.join(__dirname, '../public/uploads');
        }
        
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения!'));
        }
    }
});

module.exports = (app) => {
    const db = app.get('db');

    // ==================== КАТЕГОРИИ ====================
    router.get('/categories', authenticateToken, async (req, res) => {
        try {
            const [categories] = await db.execute('SELECT * FROM shop_categories ORDER BY sort_order');
            res.json(categories);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.post('/admin/categories', authenticateSpecialist, async (req, res) => {
        const { name, sort_order } = req.body;
        try {
            const [result] = await db.execute(
                'INSERT INTO shop_categories (name, sort_order) VALUES (?, ?)',
                [name, sort_order || 0]
            );
            res.status(201).json({ message: 'Категория добавлена', id: result.insertId });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.delete('/admin/categories/:id', authenticateSpecialist, async (req, res) => {
        try {
            await db.execute('UPDATE shop_products SET category_id = NULL WHERE category_id = ?', [req.params.id]);
            await db.execute('DELETE FROM shop_categories WHERE id = ?', [req.params.id]);
            res.json({ message: 'Категория удалена' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ==================== ТОВАРЫ ====================
    
    router.get('/admin/products', authenticateSpecialist, async (req, res) => {
        try {
            const { category, search } = req.query;
            let query = `
                SELECT p.*, c.name as category_name 
                FROM shop_products p
                LEFT JOIN shop_categories c ON p.category_id = c.id
                WHERE 1=1
            `;
            const params = [];
            
            if (category && category !== 'all') {
                query += ' AND p.category_id = ?';
                params.push(category);
            }
            if (search) {
                query += ' AND p.name LIKE ?';
                params.push(`%${search}%`);
            }
            
            query += ' ORDER BY c.sort_order, p.name';
            
            const [products] = await db.execute(query, params);
            res.json(products || []);
        } catch (error) {
            console.error('Ошибка получения товаров:', error);
            res.json([]);
        }
    });

    router.get('/admin/products/:id', authenticateSpecialist, async (req, res) => {
        try {
            const [products] = await db.execute(
                'SELECT * FROM shop_products WHERE id = ?',
                [req.params.id]
            );
            if (products.length === 0) {
                return res.status(404).json({ error: 'Товар не найден' });
            }
            res.json(products[0]);
        } catch (error) {
            console.error('Ошибка получения товара:', error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.get('/products/:id/images', authenticateToken, async (req, res) => {
        try {
            const [images] = await db.execute(
                'SELECT * FROM shop_product_images WHERE product_id = ? ORDER BY sort_order',
                [req.params.id]
            );
            res.json(images || []);
        } catch (error) {
            console.error('Ошибка получения изображений:', error);
            res.json([]);
        }
    });

    router.get('/products/:id/options', authenticateToken, async (req, res) => {
        try {
            const [options] = await db.execute(
                'SELECT * FROM shop_product_options WHERE product_id = ?',
                [req.params.id]
            );
            res.json(options || []);
        } catch (error) {
            console.error('Ошибка получения опций:', error);
            res.json([]);
        }
    });

    // ДОБАВЛЕНИЕ ТОВАРА - используем any для всех полей
    router.post('/admin/products', authenticateSpecialist, upload.any(), async (req, res) => {
        console.log('📦 POST /admin/products - Начало обработки');
        console.log('Body:', req.body);
        console.log('Files:', req.files?.length || 0);
        
        const { name, description, price, stock, category_id, has_options, options } = req.body;
        
        // Валидация
        if (!name || !price || !category_id) {
            return res.status(400).json({ error: 'Название, цена и категория обязательны' });
        }
        
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Создаем товар
            const [result] = await connection.execute(
                `INSERT INTO shop_products (name, description, price, stock, category_id, has_options, is_active, discount) 
                 VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
                [name, description || null, parseInt(price), parseInt(stock) || 0, parseInt(category_id), has_options === '1' ? 1 : 0]
            );
            
            const productId = result.insertId;
            console.log(`✅ Товар создан с ID: ${productId}`);
            
            // Сохраняем общие изображения (fieldname = 'images')
            const imageFiles = (req.files || []).filter(f => f.fieldname === 'images');
            for (let i = 0; i < imageFiles.length; i++) {
                const file = imageFiles[i];
                const imageUrl = `/uploads/products/${file.filename}`;
                await connection.execute(
                    'INSERT INTO shop_product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)',
                    [productId, imageUrl, i]
                );
                console.log(`✅ Общее изображение ${i+1} сохранено`);
            }
            
            // Сохраняем опции
            if (has_options === '1' && options) {
                let parsedOptions;
                try {
                    parsedOptions = typeof options === 'string' ? JSON.parse(options) : options;
                } catch(e) {
                    parsedOptions = [];
                }
                
                let colorIndex = 0;
                for (let i = 0; i < parsedOptions.length; i++) {
                    const opt = parsedOptions[i];
                    if (opt.value && opt.value.trim()) {
                        let imageUrl = null;
                        
                        // Для цветов ищем соответствующее изображение
                        if (opt.type === 'color') {
                            const colorImageFile = (req.files || []).find(f => f.fieldname === `color_image_${colorIndex}`);
                            if (colorImageFile) {
                                imageUrl = `/uploads/colors/${colorImageFile.filename}`;
                                console.log(`✅ Изображение для цвета "${opt.value}" сохранено`);
                            }
                            colorIndex++;
                        }
                        
                        await connection.execute(
                            `INSERT INTO shop_product_options (product_id, option_name, option_value, stock, extra_price, image_url) 
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [productId, opt.type, opt.value.trim(), parseInt(opt.stock) || 0, parseInt(opt.extra_price) || 0, imageUrl]
                        );
                        console.log(`✅ Опция добавлена: ${opt.type} - ${opt.value}`);
                    }
                }
            }
            
            await connection.commit();
            console.log(`✅ Товар "${name}" успешно добавлен`);
            res.status(201).json({ message: 'Товар добавлен', id: productId });
            
        } catch (error) {
            await connection.rollback();
            console.error('❌ Ошибка при добавлении товара:', error);
            res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
        } finally {
            connection.release();
        }
    });

    // ОБНОВЛЕНИЕ ТОВАРА
    router.put('/admin/products/:id', authenticateSpecialist, upload.any(), async (req, res) => {
        console.log('📦 PUT /admin/products/:id - Начало обработки');
        
        const { name, description, price, is_active, discount, options } = req.body;
        const productId = req.params.id;
        
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Обновляем
            await connection.execute(
                `UPDATE shop_products 
                 SET name = ?, description = ?, price = ?, is_active = ?, discount = ?
                 WHERE id = ?`,
                [name, description || null, parseInt(price), is_active === '1' ? 1 : 0, discount || 0, productId]
            );
            
            // Добавляем новые общие изображения
            const imageFiles = (req.files || []).filter(f => f.fieldname === 'images');
            for (let i = 0; i < imageFiles.length; i++) {
                const file = imageFiles[i];
                const imageUrl = `/uploads/products/${file.filename}`;
                await connection.execute(
                    'INSERT INTO shop_product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)',
                    [productId, imageUrl, 999 + i]
                );
            }
            
            // Обновляем опции
            if (options) {
                let parsedOptions;
                try {
                    parsedOptions = typeof options === 'string' ? JSON.parse(options) : options;
                } catch(e) {
                    parsedOptions = [];
                }
                
                // Удаляем старые опции
                await connection.execute('DELETE FROM shop_product_options WHERE product_id = ?', [productId]);
                
                let colorIndex = 0;
                for (let i = 0; i < parsedOptions.length; i++) {
                    const opt = parsedOptions[i];
                    if (opt.value && opt.value.trim()) {
                        let imageUrl = opt.image_url || null;
                        
                        // Для цветов ищем соответствующее изображение
                        if (opt.type === 'color') {
                            const colorImageFile = (req.files || []).find(f => f.fieldname === `color_image_${colorIndex}`);
                            if (colorImageFile) {
                                imageUrl = `/uploads/colors/${colorImageFile.filename}`;
                            }
                            colorIndex++;
                        }
                        
                        await connection.execute(
    `INSERT INTO shop_product_options (product_id, option_name, option_value, stock, extra_price) 
     VALUES (?, ?, ?, ?, ?)`,
    [productId, opt.type, opt.value.trim(), parseInt(opt.stock) || 0, parseInt(opt.extra_price) || 0]
);
                    }
                }
            }
            
            await connection.commit();
            console.log(`✅ Товар обновлен`);
            res.json({ message: 'Товар обновлен' });
            
        } catch (error) {
            await connection.rollback();
            console.error('❌ Ошибка при обновлении товара:', error);
            res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
        } finally {
            connection.release();
        }
    });

    // Удаление товара
    router.delete('/admin/products/:id', authenticateSpecialist, async (req, res) => {
        try {
            await db.execute('DELETE FROM shop_products WHERE id = ?', [req.params.id]);
            res.json({ message: 'Товар удален' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Включение/выключение товара
    router.put('/admin/products/:id/toggle', authenticateSpecialist, async (req, res) => {
        const { is_active } = req.body;
        try {
            await db.execute('UPDATE shop_products SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, req.params.id]);
            res.json({ message: 'Статус обновлен' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Удаление изображения
    router.delete('/products/image/:id', authenticateSpecialist, async (req, res) => {
        try {
            const [images] = await db.execute(
                'SELECT image_url FROM shop_product_images WHERE id = ?',
                [req.params.id]
            );
            
            if (images.length > 0) {
                const filePath = path.join(__dirname, '../public', images[0].image_url);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
            
            await db.execute('DELETE FROM shop_product_images WHERE id = ?', [req.params.id]);
            res.json({ message: 'Изображение удалено' });
        } catch (error) {
            console.error('Ошибка удаления изображения:', error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Получение товаров для пользователя
    router.get('/products', authenticateToken, async (req, res) => {
    try {
        const { category, search } = req.query; // Извлекаем параметры из URL[cite: 10]
        
        let query = `
            SELECT p.*, c.name as category_name 
            FROM shop_products p
            LEFT JOIN shop_categories c ON p.category_id = c.id
            WHERE p.is_active = 1
        `;
        const params = [];

        // Добавляем фильтр по категории
        if (category && category !== 'all') {
            query += ' AND p.category_id = ?';
            params.push(category);
        }

        // Добавляем фильтр по поисковому слову
        if (search) {
            query += ' AND p.name LIKE ?';
            params.push(`%${search}%`);
        }

        query += ' ORDER BY c.sort_order, p.name';

        const [products] = await db.execute(query, params);
        res.json(products || []);
    } catch (error) {
        console.error('Ошибка получения товаров для пользователя:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

    // ==================== КОРЗИНА ====================
    router.get('/cart', authenticateToken, async (req, res) => {
        try {
            const [cart] = await db.execute(`
                SELECT c.*, p.name as product_name, p.price,
                       po.option_name, po.option_value
                FROM shop_cart c
                JOIN shop_products p ON c.product_id = p.id
                LEFT JOIN shop_product_options po ON c.option_id = po.id
                WHERE c.user_id = ?
            `, [req.user.userId]);
            res.json(cart);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.post('/cart', authenticateToken, async (req, res) => {
        const { product_id, option_id, quantity } = req.body;
        
        try {
            const [existing] = await db.execute(
                'SELECT id, quantity FROM shop_cart WHERE user_id = ? AND product_id = ? AND (option_id = ? OR (option_id IS NULL AND ? IS NULL))',
                [req.user.userId, product_id, option_id, option_id]
            );
            
            if (existing.length > 0) {
                await db.execute(
                    'UPDATE shop_cart SET quantity = quantity + ? WHERE id = ?',
                    [quantity || 1, existing[0].id]
                );
            } else {
                await db.execute(
                    'INSERT INTO shop_cart (user_id, product_id, option_id, quantity) VALUES (?, ?, ?, ?)',
                    [req.user.userId, product_id, option_id, quantity || 1]
                );
            }
            
            res.json({ message: 'Товар добавлен в корзину' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.put('/cart/:id', authenticateToken, async (req, res) => {
        const { quantity } = req.body;
        try {
            await db.execute(
                'UPDATE shop_cart SET quantity = ? WHERE id = ? AND user_id = ?',
                [quantity, req.params.id, req.user.userId]
            );
            res.json({ message: 'Корзина обновлена' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.delete('/cart/:id', authenticateToken, async (req, res) => {
        try {
            await db.execute(
                'DELETE FROM shop_cart WHERE id = ? AND user_id = ?',
                [req.params.id, req.user.userId]
            );
            res.json({ message: 'Товар удален' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ==================== ЗАКАЗЫ ====================
    router.post('/order', authenticateToken, async (req, res) => {
    const { contact_name, contact_phone, delivery_address, comment } = req.body;
    
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const [cart] = await connection.execute(`
            SELECT c.*, p.name as product_name, p.price,
                   po.option_name, po.option_value, po.extra_price
            FROM shop_cart c
            JOIN shop_products p ON c.product_id = p.id
            LEFT JOIN shop_product_options po ON c.option_id = po.id
            WHERE c.user_id = ?
        `, [req.user.userId]);
        
        if (cart.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Корзина пуста' });
        }
        
        const [user] = await connection.execute(
            'SELECT total_rating, full_name, vk_id FROM users WHERE id = ?',
            [req.user.userId]
        );
        
        let totalPrice = 0;
        for (const item of cart) {
            totalPrice += item.price * item.quantity;
        }
        
        if (user[0].total_rating < totalPrice) {
            await connection.rollback();
            return res.status(400).json({ error: 'Недостаточно баллов' });
        }
        
        const orderNumber = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        
        const [order] = await connection.execute(
            `INSERT INTO shop_orders (user_id, order_number, total_price, status, contact_name, contact_phone, delivery_address, comment)
             VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
            [req.user.userId, orderNumber, totalPrice, contact_name || null, contact_phone || null, delivery_address || null, comment || null]
        );
        
        for (const item of cart) {
            await connection.execute(
                `INSERT INTO shop_order_items (order_id, product_id, product_name, option_name, option_value, quantity, price)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [order.insertId, item.product_id, item.product_name, item.option_name, item.option_value, item.quantity, item.price]
            );
            
            if (item.option_id) {
                await connection.execute(
                    'UPDATE shop_product_options SET stock = stock - ? WHERE id = ?',
                    [item.quantity, item.option_id]
                );
            } else {
                await connection.execute(
                    'UPDATE shop_products SET stock = stock - ? WHERE id = ?',
                    [item.quantity, item.product_id]
                );
            }
        }
        
        await connection.execute(
            'UPDATE users SET total_rating = total_rating - ? WHERE id = ?',
            [totalPrice, req.user.userId]
        );
        
        await connection.execute('DELETE FROM shop_cart WHERE user_id = ?', [req.user.userId]);
        
        await connection.commit();
        
        // ==================== ОТПРАВКА УВЕДОМЛЕНИЙ ====================
        const { sendOrderNotification, sendMerchantNotification } = require('../utils/vk-bot');
        
        // Уведомление пользователю
        if (user[0].vk_id) {
            await sendOrderNotification(user[0].vk_id, {
                orderNumber,
                totalPrice,
                items: cart.map(i => ({ name: i.product_name, quantity: i.quantity, price: i.price }))
            });
            console.log(`✅ Уведомление о заказе отправлено пользователю ${user[0].vk_id}`);
        } else {
            console.log(`⚠️ У пользователя ${user[0].full_name} не указан VK ID`);
        }
        
        // Уведомления всем специалистам
        const [merchants] = await connection.execute(
            `SELECT u.id, u.vk_id, u.full_name 
             FROM users u 
             WHERE u.role = 'specialist'`
        );
        
        for (const merchant of merchants) {
            if (merchant.vk_id) {
                await sendMerchantNotification(merchant.vk_id, {
                    orderNumber,
                    orderId: order.insertId,
                    userName: user[0].full_name,
                    userVkId: user[0].vk_id ? '@' + user[0].vk_id : user[0].full_name,
                    totalPrice,
                    items: cart.map(i => ({ name: i.product_name, quantity: i.quantity, price: i.price })),
                });
                console.log(`✅ Уведомление о заказе отправлено специалисту ${merchant.full_name}`);
            }
        }
        
        res.json({ message: 'Заказ оформлен', orderNumber });
        
    } catch (error) {
        await connection.rollback();
        console.error('Ошибка оформления заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    } finally {
        connection.release();
    }
});

    router.get('/orders', authenticateToken, async (req, res) => {
        try {
            const [orders] = await db.execute(`
                SELECT o.*, GROUP_CONCAT(oi.product_name SEPARATOR ', ') as items
                FROM shop_orders o
                LEFT JOIN shop_order_items oi ON o.id = oi.order_id
                WHERE o.user_id = ?
                GROUP BY o.id
                ORDER BY o.created_at DESC
            `, [req.user.userId]);
            res.json(orders);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    router.get('/admin/orders', authenticateSpecialist, async (req, res) => {
    try {
        const [orders] = await db.execute(`
            SELECT o.*, u.full_name as user_name, u.vk_id as user_vk_id,
                   GROUP_CONCAT(oi.product_name SEPARATOR ', ') as items
            FROM shop_orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN shop_order_items oi ON o.id = oi.order_id
            GROUP BY o.id
            ORDER BY o.created_at DESC
        `);
        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

    router.put('/admin/orders/:id/status', authenticateSpecialist, async (req, res) => {
        const { status } = req.body;
        try {
            await db.execute(
                'UPDATE shop_orders SET status = ? WHERE id = ?',
                [status, req.params.id]
            );
            res.json({ message: 'Статус заказа обновлен' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ==================== УПРАВЛЕНИЕ ОТВЕТСТВЕННЫМИ ЗА МЕРЧ ====================
    // Теперь эти маршруты внутри функции и доступны для выполнения

    // Получение списка текущих ответственных
    router.get('/responsible-specialists', authenticateSpecialist, async (req, res) => {
    try {
        const [specialists] = await db.execute(`
            SELECT s.responsible_user_id, s.is_active, u.full_name, u.vk_id 
            FROM shop_settings s
            JOIN users u ON s.responsible_user_id = u.id
            WHERE s.is_active = TRUE
        `);
        res.json(specialists);
    } catch (error) {
        console.error('Ошибка получения списка:', error);
        // Если таблицы нет, возвращаем пустой массив
        res.json([]);
    }
});

    // Получение списка ВСЕХ специалистов (для выпадающего списка добавления)
    router.get('/available-specialists', authenticateSpecialist, async (req, res) => {
    try {
        const [specialists] = await db.execute(
            "SELECT id, full_name, vk_id FROM users WHERE role = 'specialist'"
        );
        res.json(specialists);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

    // Добавление специалиста в список уведомлений
    router.post('/responsible-specialists', authenticateSpecialist, async (req, res) => {
        const { user_id } = req.body;
        try {
            await db.execute(
                `INSERT INTO shop_settings (responsible_user_id, is_active) VALUES (?, TRUE)
                 ON DUPLICATE KEY UPDATE is_active = TRUE`,
                [user_id]
            );
            res.json({ message: 'Специалист добавлен' });
        } catch (error) {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Удаление из списка уведомлений
    router.delete('/responsible-specialists/:id', authenticateSpecialist, async (req, res) => {
        try {
            await db.execute(
                'UPDATE shop_settings SET is_active = FALSE WHERE responsible_user_id = ?',
                [req.params.id]
            );
            res.json({ message: 'Специалист удален из уведомлений' });
        } catch (error) {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    return router;
};