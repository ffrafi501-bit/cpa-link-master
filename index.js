const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const shortid = require('shortid');
const app = express();

// --- কনফিগারেশন (আপনার ডাটাবেস লিংক এখানে বসবে না, এটা এনভায়রনমেন্ট থেকে আসবে) ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// মিডলওয়্যার
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: true
}));

// --- ডাটাবেস কানেকশন ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log(err));

// --- ডাটাবেস মডেল (Schema) ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' }, // user or admin
    plan: { type: String, default: 'free' }, // free or premium
    isApproved: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

const LinkSchema = new mongoose.Schema({
    originalUrl: String,
    shortCode: String, // অফারের নাম
    owner: String,
    clicks: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const Link = mongoose.model('Link', LinkSchema);

// --- মিডলওয়্যার (লগিন চেক করার জন্য) ---
const requireLogin = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.send("Access Denied: Admins Only");
    }
    next();
};

// --- রাউটস (Routes) ---

// ১. হোমপেজ / লগিন
app.get('/', (req, res) => {
    res.render('login');
});

// ২. রেজিস্ট্রেশন (রিকোয়েস্ট অ্যাক্সেস)
app.get('/register', (req, res) => res.render('register'));

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        res.send("Request Sent! Please wait for Admin approval.");
    } catch (err) {
        res.send("Username already taken or Error.");
    }
});

// ৩. লগিন সিস্টেম
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user) return res.redirect('/');
    if (!user.isApproved) return res.send("Account Pending Approval by Admin");

    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
        req.session.user = user;
        if (user.role === 'admin') return res.redirect('/admin');
        return res.redirect('/dashboard');
    }
    res.redirect('/');
});

// ৪. ড্যাশবোর্ড (ইউজারদের জন্য)
app.get('/dashboard', requireLogin, async (req, res) => {
    const links = await Link.find({ owner: req.session.user.username });
    res.render('dashboard', { user: req.session.user, links });
});

app.post('/shorten', requireLogin, async (req, res) => {
    const { originalUrl, customAlias } = req.body;
    let shortCode = customAlias || shortid.generate();

    // ডুপ্লিকেট চেক
    const exist = await Link.findOne({ shortCode });
    if (exist) return res.send("This name is already taken!");

    const newLink = new Link({
        originalUrl,
        shortCode,
        owner: req.session.user.username
    });
    await newLink.save();
    res.redirect('/dashboard');
});

// ৫. অ্যাডমিন প্যানেল
app.get('/admin', requireAdmin, async (req, res) => {
    const users = await User.find();
    res.render('admin', { users });
});

app.post('/admin/approve/:id', requireAdmin, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { isApproved: true });
    res.redirect('/admin');
});

app.post('/admin/delete/:id', requireAdmin, async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
});

// ৬. লগআউট
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ৭. মেইন রিডাইরেক্ট লজিক (সবশেষে থাকবে)
app.get('/:code', async (req, res) => {
    const link = await Link.findOne({ shortCode: req.params.code });
    if (!link) return res.send("404 - Offer Not Found");

    // ক্লিক আপডেট
    link.clicks++;
    await link.save();

    // ইউজার প্ল্যান চেক
    const user = await User.findOne({ username: link.owner });

    // যদি প্রিমিয়াম ইউজার হয় -> সরাসরি রিডাইরেক্ট
    if (user && user.plan === 'premium') {
        return res.redirect(link.originalUrl);
    }

    // যদি ফ্রি ইউজার হয় -> অ্যাড পেজ দেখাবে (views/redirect.ejs)
    res.render('redirect', { destination: link.originalUrl });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));