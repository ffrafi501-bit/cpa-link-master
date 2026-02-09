const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const shortid = require('shortid');
const path = require('path');

const User = require('./models/User');
const Link = require('./models/Link');

const app = express();
const PORT = process.env.PORT || 3000;

// --- ১. কনফিগারেশন এবং মিডলওয়্যার ---
// View Engine সেটআপ (Path মডিউল ব্যবহার করে ফিক্স করা হয়েছে)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'secret-cpa-key-123',
    resave: false,
    saveUninitialized: true
}));

// --- ২. ডাটাবেস কানেকশন ---
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ MongoDB Connected");
    } catch (err) {
        console.error("❌ MongoDB Error:", err.message);
    }
};
connectDB();

// --- ৩. অথেন্টিকেশন মিডলওয়্যার ---
const requireLogin = (req, res, next) => {
    if (!req.session.user) return res.redirect('/');
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.send("Access Denied: Admins Only");
    }
    next();
};

// --- ৪. মেইন সাব-ডোমেইন এবং রাউটিং লজিক ---

app.use(async (req, res, next) => {
    const host = req.headers.host;
    // আপনার ডোমেইন নেম এখানে দিন (লোকালহোস্ট টেস্টিংয়ের জন্য localhost রাখা হলো)
    // প্রোডাকশনে আপনার ডোমেইন হবে: 'yourdomain.site'
    const mainDomain = 'cpa-link-master.vercel.app';

    // লোকালহোস্ট বা মেইন ডোমেইন হলে সাধারণ রাউট কাজ করবে
    if (host.includes('localhost') || host === mainDomain || host.startsWith('www.')) {
        return next();
    }

    // --- সাব-ডোমেইন লজিক (যেমন: rakib.yourdomain.site) ---
    const subdomain = host.split('.')[0];

    // ইউজার চেক করা
    const user = await User.findOne({ username: subdomain });
    if (!user) return res.send("User/Subdomain not found!");
    if (!user.isApproved) return res.send("This account is not active yet.");

    // অফার লিংক চেক করা (URL এর পাথ থেকে)
    const slug = req.url.substring(1); // '/gift' -> 'gift'

    if (!slug) return res.send(`Welcome to ${user.username}'s Offer Page`);

    const link = await Link.findOne({ owner: user.username, shortCode: slug });
    if (!link) return res.send("Offer expired or not found!");

    // ক্লিক আপডেট
    link.clicks++;
    await link.save();

    // লজিক: ফ্রি বনাম প্রিমিয়াম
    if (user.plan === 'premium') {
        return res.redirect(link.originalUrl);
    } else {
        // ফ্রি ইউজার হলে অ্যাড পেজ দেখাবে
        return res.render('redirect', { destination: link.originalUrl });
    }
});

// --- ৫. সাধারণ রাউটস (লগিন/রেজিস্টার/ড্যাশবোর্ড) ---

// হোমপেজ (লগিন)
app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('login');
});

// রেজিস্ট্রেশন
app.get('/register', (req, res) => res.render('register'));

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    // সাধারণ ভ্যালিডেশন
    if (!username || !password) return res.send("All fields required");

    // ইউজারনেম ছোট হাতের করে নেওয়া এবং স্পেস সরানো
    const cleanUsername = username.toLowerCase().replace(/\s+/g, '');

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username: cleanUsername, password: hashedPassword });
        await newUser.save();
        res.render('login', { msg: "Request Sent! Please wait for Admin approval." });
    } catch (err) {
        res.send("Username already taken! Try another.");
    }
});

// লগিন অ্যাকশন
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase() });

    if (!user) return res.redirect('/');
    if (!user.isApproved) return res.send("Your account is pending approval by Admin.");

    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
        req.session.user = user;
        if (user.role === 'admin') return res.redirect('/admin');
        return res.redirect('/dashboard');
    }
    res.redirect('/');
});

// ড্যাশবোর্ড
app.get('/dashboard', requireLogin, async (req, res) => {
    const links = await Link.find({ owner: req.session.user.username }).sort({ createdAt: -1 });
    res.render('dashboard', { user: req.session.user, links });
});

// লিংক তৈরি করা
app.post('/shorten', requireLogin, async (req, res) => {
    const { originalUrl, customAlias } = req.body;
    let shortCode = customAlias ? customAlias.trim() : shortid.generate();

    const exist = await Link.findOne({ shortCode, owner: req.session.user.username });
    if (exist) return res.send("You already used this name!");

    const newLink = new Link({
        originalUrl,
        shortCode,
        owner: req.session.user.username
    });
    await newLink.save();
    res.redirect('/dashboard');
});

// অ্যাডমিন প্যানেল
app.get('/admin', requireAdmin, async (req, res) => {
    const users = await User.find();
    res.render('admin', { users });
});

// অ্যাডমিন অ্যাকশন (Approve)
app.post('/admin/approve/:id', requireAdmin, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { isApproved: true });
    res.redirect('/admin');
});

// অ্যাডমিন অ্যাকশন (Premium/Free Toggle)
app.post('/admin/toggle-plan/:id', requireAdmin, async (req, res) => {
    const user = await User.findById(req.params.id);
    user.plan = user.plan === 'free' ? 'premium' : 'free';
    await user.save();
    res.redirect('/admin');
});

// লগআউট
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- ৬. ডিরেক্ট লিংক রিডাইরেক্ট (মেইন ডোমেইনের জন্য) ---
app.get('/:code', async (req, res) => {
    // এই অংশটি মেইন ডোমেইনের শর্ট লিংকের জন্য (যদি লাগে)
    // তবে আমাদের মূল ফোকাস সাব-ডোমেইনে, যা উপরে হ্যান্ডেল করা হয়েছে।
    res.redirect('/');
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));