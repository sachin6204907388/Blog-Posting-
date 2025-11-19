require('dotenv').config({ debug: true }); // Load env first!

const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const bodyParser = require('body-parser');
const twilio = require("twilio");

const app = express();
const port = process.env.PORT || 8080;

// ===== Debugging: Check Twilio variables =====
console.log("Twilio SID:", process.env.TWILIO_SID);
console.log("Twilio Auth Token:", process.env.TWILIO_AUTH_TOKEN ? "Loaded ✅" : "Missing ❌");
console.log("Twilio Phone:", process.env.TWILIO_PHONE);

// ===== Middleware =====
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: false }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/static', express.static(path.join(__dirname, 'public')));

// ===== MySQL connection =====
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'sachin9122', // Replace with your MySQL root password
    database: 'blogs'
});

connection.connect((err) => {
    if (err) {
        console.error('❌ MySQL connection error:', err);
        return;
    }
    console.log('✅ Connected to MySQL');
});

// ===== Temporary OTP storage =====
let otpStore = {};

// ===== Registration Routes =====
app.get('/register', (req, res) => res.render('register'));

app.post("/register", async (req, res) => {
  const { username, email, password, phone } = req.body;
  if (!username || !email || !password || !phone) {
    return res.status(400).send("All fields are required.");
  }

  // Generate 4-digit OTP
  const otp = Math.floor(1000 + Math.random() * 9000);
  otpStore[phone] = {
    otp,
    username,
    email,
    password,
    expires: Date.now() + 5 * 60 * 1000 // 5 minutes
  };

  try {
    const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
    const message = await client.messages.create({
      body: `Your OTP for registration is ${otp}`,
      from: process.env.TWILIO_PHONE,
      to: phone
    });

    console.log("OTP sent successfully:", message.sid);
    res.render("verify-register-otp", { phone });
  } catch (error) {
    console.error("Error sending OTP:", error.message);
    res.status(500).send("Error sending OTP, please try again.");
  }
});

app.post("/verify-register-otp", (req, res) => {
  const { phone, otp } = req.body;
  const record = otpStore[phone];

  if (!record) return res.status(400).send("No OTP request for this phone.");
  if (record.expires < Date.now()) {
    delete otpStore[phone];
    return res.status(400).send("OTP expired.");
  }
  if (record.otp.toString() !== otp.toString()) {
    return res.status(400).send("Invalid OTP.");
  }

  const sql = "INSERT INTO users (username, email, password, phone) VALUES (?, ?, ?, ?)";
  connection.query(sql, [record.username, record.email, record.password, phone], (err) => {
    if (err) return res.status(500).send("Database error: " + err.sqlMessage);
    delete otpStore[phone];
    res.render("register-success");
  });
});

// ===== Login Routes =====
app.get('/login', (req, res) => res.render('login'));

app.post('/login-in', (req, res) => {
  const { email, password } = req.body;
  const sql = 'SELECT * FROM users WHERE email = ? AND password = ?';
  connection.query(sql, [email, password], (err, results) => {
    if (err) return res.send('Error during login');
    if (results.length > 0) res.redirect('/writeblogs');
    else res.send('Invalid email or password');
  });
});

// ===== Blog Routes =====
app.get('/writeblogs', (req, res) => res.render('writeblogs'));

app.post('/send-otp', (req, res) => {
  const { title, author, content } = req.body;
  if (!title || !author || !content) return res.status(400).send("All fields are required.");

  const sql = "INSERT INTO content (title, author, content) VALUES (?, ?, ?)";
  connection.query(sql, [title, author, content], (err) => {
    if (err) return res.status(500).send("Database error: " + err.sqlMessage);
    res.redirect("/allblogs");
  });
});

app.get("/allblogs", (req, res) => {
  const sql = "SELECT * FROM content ORDER BY created_at DESC";
  connection.query(sql, (err, results) => {
    if (err) return res.status(500).send("Database error: " + err.sqlMessage);
    res.render("allblogs", { blogs: results });
  });
});

// ===== Comments Routes =====
app.get("/comments/:id", (req, res) => {
  const blogId = req.params.id;
  const blogQuery = "SELECT * FROM content WHERE id = ?";
  const commentQuery = "SELECT * FROM comments WHERE blog_id = ? ORDER BY id ASC";

  connection.query(blogQuery, [blogId], (err, blogs) => {
    if (err) return res.status(500).send(err);
    if (blogs.length === 0) return res.status(404).send("Blog not found");

    connection.query(commentQuery, [blogId], (err, comments) => {
      if (err) return res.status(500).send(err);
      blogs[0].comments = comments;
      res.render("comments", { blogs: blogs });
    });
  });
});

app.post("/comment/:id", (req, res) => {
  const blogId = req.params.id;
  const comment = req.body.comment;
  if (!comment) return res.status(400).send("Comment text is required");

  connection.query("INSERT INTO comments (blog_id, comment) VALUES (?, ?)", [blogId, comment], (err) => {
    if (err) return res.status(500).send("Database error: " + err.sqlMessage);
    res.redirect("/comments/" + blogId);
  });
});

// ===== Edit Blog Password Check =====
app.post('/check-password/:id', (req, res) => {
  const blogId = req.params.id;
  const { password } = req.body;

  connection.query("SELECT * FROM content WHERE id = ?", [blogId], (err, results) => {
    if (err || results.length === 0) return res.json({ success: false });

    const blog = results[0];
    if (blog.password === password) {
      return res.json({ success: true });
    } else {
      return res.json({ success: false });
    }
  });
});

// ===== Delete Blog =====
app.post("/delete-blog/:id", (req, res) => {
  const blogId = req.params.id;
  const { password } = req.body;

  connection.query("SELECT * FROM content WHERE id = ?", [blogId], (err, results) => {
    if (err || results.length === 0) return res.json({ success: false });

    const blog = results[0];
    if (blog.password !== password) {
      return res.json({ success: false });
    }

    connection.query("DELETE FROM content WHERE id = ?", [blogId], (err2) => {
      if (err2) return res.json({ success: false });
      res.json({ success: true });
    });
  });
});

// ===== Start Server =====
app.listen(port, () => console.log(`🚀 Server running at http://localhost:${port}`));
