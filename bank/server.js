// server.js (نسخه با دیتابیس JSON)
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname)); // برای دسترسی به فایل‌های HTML و CSS

const DATA_FILE = path.join(__dirname, 'data.json');

// ---------------------------
// 📁 توابع مدیریت فایل JSON
// ---------------------------

function readData() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error("Error reading data.json:", error);
        // اگر فایل خالی یا نامعتبر بود، ساختار پیش‌فرض را برمی‌گرداند.
        return { users: [], accounts: [], transactions: [], nextUserId: 1, nextAccountId: 100, nextTransactionId: 1 };
    }
}

function writeData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error("Error writing to data.json:", error);
    }
}

// ---------------------------
// ۱. احراز هویت و ثبت‌نام (Auth)
// ---------------------------

app.post('/api/register', (req, res) => {
    const { username, password, email } = req.body;
    const data = readData();

    if (data.users.find(u => u.username === username)) {
        return res.status(400).json({ message: 'نام کاربری قبلاً وجود دارد.' });
    }

    const newUser = {
        id: data.nextUserId++,
        username,
        password, // در محیط واقعی باید هش شود
        email,
        role: 'user',
        isActive: true
    };
    data.users.push(newUser);

    const newAccount = {
        id: data.nextAccountId++,
        userId: newUser.id,
        accountNumber: Math.floor(10000000 + Math.random() * 90000000).toString(),
        balance: 0.00
    };
    data.accounts.push(newAccount);

    writeData(data);

    res.json({ message: 'ثبت‌نام موفقیت‌آمیز. لطفاً وارد شوید.', account: newAccount });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const data = readData();
    const user = data.users.find(u => u.username === username && u.password === password);

    if (user) {
        // ID کاربر به عنوان "توکن" استفاده می‌شود.
        return res.json({ token: user.id, role: user.role, username: user.username });
    }
    res.status(401).json({ message: 'نام کاربری یا رمز عبور اشتباه است.' });
});

// ---------------------------
// ۲. منطق کاربر عادی (User Logic)
// ---------------------------

const getUserMiddleware = (req, res, next) => {
    const userId = parseInt(req.headers['authorization']);
    const data = readData();
    req.user = data.users.find(u => u.id === userId);

    if (!req.user || !req.user.isActive) {
        return res.status(401).json({ message: 'دسترسی غیرمجاز.' });
    }
    req.db = data; // دیتابیس را برای استفاده در مسیرهای بعدی ضمیمه می‌کنیم
    next();
};

app.get('/api/user/dashboard', getUserMiddleware, (req, res) => {
    const userAccount = req.db.accounts.find(a => a.userId === req.user.id);
    const userTransactions = req.db.transactions.filter(t => t.sourceUserId === req.user.id || t.destUserId === req.user.id);
    
    res.json({ 
        username: req.user.username,
        account: userAccount,
        transactions: userTransactions.reverse().slice(0, 10) 
    });
});

app.post('/api/user/transfer', getUserMiddleware, (req, res) => {
    const { sourceAcc, destAcc, amount } = req.body;
    const amountFloat = parseFloat(amount);
    const data = req.db;

    const sourceAccount = data.accounts.find(a => a.accountNumber === sourceAcc && a.userId === req.user.id);
    const destAccount = data.accounts.find(a => a.accountNumber === destAcc);

    if (!sourceAccount) return res.status(404).json({ message: 'حساب مبدأ شما پیدا نشد.' });
    if (!destAccount) return res.status(404).json({ message: 'حساب مقصد پیدا نشد.' });
    if (amountFloat <= 0 || sourceAccount.balance < amountFloat) return res.status(400).json({ message: 'موجودی کافی نیست یا مبلغ نامعتبر است.' });

    // اجرای تراکنش
    sourceAccount.balance -= amountFloat;
    destAccount.balance += amountFloat;

    const newTransaction = {
        id: data.nextTransactionId++,
        sourceUserId: req.user.id,
        destUserId: destAccount.userId,
        type: 'TRANSFER',
        amount: amountFloat,
        timestamp: new Date().toLocaleString('fa-IR'),
        description: `انتقال به ${destAccount.accountNumber}`
    };
    data.transactions.push(newTransaction);
    
    writeData(data); // ذخیره تغییرات

    res.json({ 
        message: 'انتقال موفقیت‌آمیز.', 
        newBalance: sourceAccount.balance 
    });
});

// ---------------------------
// ۳. منطق ادمین (Admin Logic - فول دسترسی)
// ---------------------------

const adminRequired = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'فقط برای ادمین مجاز است.' });
    }
    next();
};

app.get('/api/admin/users', getUserMiddleware, adminRequired, (req, res) => {
    const data = req.db;
    const usersWithAccounts = data.users.map(u => {
        const acc = data.accounts.find(a => a.userId === u.id);
        return { 
            id: u.id, 
            username: u.username, 
            role: u.role, 
            isActive: u.isActive,
            accountNumber: acc ? acc.accountNumber : 'N/A',
            balance: acc ? acc.balance : 0
        };
    });
    res.json({ users: usersWithAccounts });
});

app.post('/api/admin/direct_op', getUserMiddleware, adminRequired, (req, res) => {
    const { targetAcc, amount, type } = req.body;
    const amountFloat = parseFloat(amount);
    const data = req.db;
    
    const targetAccount = data.accounts.find(a => a.accountNumber === targetAcc);

    if (!targetAccount) return res.status(404).json({ message: 'حساب مقصد/مبدأ پیدا نشد.' });
    if (amountFloat <= 0) return res.status(400).json({ message: 'مبلغ نامعتبر است.' });

    if (type === 'DEPOSIT') {
        targetAccount.balance += amountFloat;
        data.transactions.push({
            id: data.nextTransactionId++,
            sourceUserId: req.user.id, // ادمین
            destUserId: targetAccount.userId,
            type: 'ADMIN_DEPOSIT',
            amount: amountFloat,
            timestamp: new Date().toLocaleString('fa-IR'),
            description: 'واریز مستقیم توسط ادمین'
        });
        
    } else if (type === 'WITHDRAWAL') {
        if (targetAccount.balance < amountFloat) return res.status(400).json({ message: 'موجودی کافی نیست.' });
        
        targetAccount.balance -= amountFloat;
        data.transactions.push({
            id: data.nextTransactionId++,
            sourceUserId: targetAccount.userId,
            destUserId: req.user.id, // ادمین (به عنوان مرجع)
            type: 'ADMIN_WITHDRAWAL',
            amount: amountFloat,
            timestamp: new Date().toLocaleString('fa-IR'),
            description: 'برداشت مستقیم توسط ادمین'
        });
    } else {
        return res.status(400).json({ message: 'عملیات نامعتبر.' });
    }
    
    writeData(data); // ذخیره تغییرات

    res.json({ message: `${type === 'DEPOSIT' ? 'واریز' : 'برداشت'} مستقیم ${amountFloat} واحدی به/از حساب ${targetAcc} با موفقیت انجام شد.` });
});

app.post('/api/admin/toggle_active', getUserMiddleware, adminRequired, (req, res) => {
    const { userId, isActive } = req.body;
    const data = req.db;
    const userToToggle = data.users.find(u => u.id === userId);

    if (!userToToggle) return res.status(404).json({ message: 'کاربر پیدا نشد.' });

    userToToggle.isActive = isActive;
    writeData(data); // ذخیره تغییرات

    res.json({ message: `وضعیت کاربر ${userToToggle.username} به ${isActive ? 'فعال' : 'غیرفعال'} تغییر یافت.` });
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Data is stored in data.json`);
});