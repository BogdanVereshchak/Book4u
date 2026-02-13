import express from "express"
import pg from "pg"
import jwt from "jsonwebtoken"
import cookieParser from 'cookie-parser';
import axios from "axios"
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const port = process.env.PORT || 3000;
const app = express();

// Trust Cloudflare Tunnel proxy to fix express-rate-limit validation error
app.set('trust proxy', 1);

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "https://covers.openlibrary.org", "https://archive.org", "https://*.archive.org"],
    },
  },
}));

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use(limiter);

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(cookieParser());

const loadUserBooks = async (req, res, next)=>{
    if (req.user) {
        const books = await db.query(`
            SELECT r.id, r.book_id, b.title, b.author_name, b.first_publish_year, b.cover_id, r.review, r.rating, r.read_date
            FROM user_books as r join books as b on r.book_id = b.id
            inner join users as u on r.user_id = u.id
            where u.id = $1
            order by r.rating desc, b.title asc;`, [req.user.id]);
        req.userBooks = books.rows;
    }
    next();
};
const authenticateToken = (req, res, next) => {
    const token = req.cookies.accessToken;
    if (!token) {
        req.user = null;
        return next();
    }
    jwt.verify(token, process.env.SECRET_KEY, (err, user) => {
        if (err) {
            res.clearCookie("accessToken");
            req.user = null;
        } else {
            req.user = user; 
        }
        next();
    });
};

app.use(authenticateToken);
app.use(loadUserBooks);

const db = new pg.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});
// db.connect() is handled automatically by the pool

class Book {
    constructor(title, author_name, first_publish_year, cover_id) {
        this.title = title;
        this.author_name = author_name;
        this.first_publish_year = first_publish_year;
        this.cover_id = cover_id;
    }
    async add() {
        try {
            const book = await db.query(`
            Insert into books (title, author_name, first_publish_year, cover_id) 
            values ($1, $2, $3, $4) returning id`, [this.title, this.author_name, this.first_publish_year, this.cover_id]);
            this.id = book.rows[0].id;
            // console.log(this.id);
            return this.id;
        } catch (error) {
            const id = this.get(this.title);
            return id;}
    }
    async get(id) {
        try {
            const data = await db.query("Select * from books where id=$1", [id]);
            return data.rows[0];
        } catch (error) {return null}
    }
}

class UserBooks {
    constructor({user_id=0, book_id=0, review="", rating=0, read_date=0, id = 0}={}) {
        this.user_id = user_id;
        this.book_id = book_id;
        this.review = review;
        this.rating = rating;
        this.read_date = read_date;
        this.id = id;
    }
    async add() {
        this.id = await db.query(`
        Insert into user_books (user_id, book_id, review, rating, read_date)
        values ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE)) returning id`, [this.user_id, this.book_id, this.review, this.rating, this.read_date]);
    }

    async del(){
        await db.query(`Delete from user_books where id = $1`, [this.id]);
    }
    async edit(){
        await db.query(`update user_books set review=$1, rating=$2, read_date=$3 where id=$4`,[this.review, this.rating,this.read_date,this.id]);
    }
}

app.get("/", async (req, res) => {
    if (!req.user) {
        return res.redirect("/login");
    }
    res.render("index.ejs", { 
        user: req.user, 
        books: req.userBooks
    });
});

app.get("/search", async (req,res)=>{
    const searchTerm = req.query.bookName;
    const search = await searchBooks(searchTerm);
    res.render("search.ejs", {result : search, user: req.user});
});

app.get("/register", async (req, res) => {
    res.render("register.ejs");
});

app.get("/login", async (req, res) => {
    res.render("login.ejs");
});

app.post("/register", async (req, res) => {
    const { name, password } = req.body;
    const newUser = await registerUser(name, password);
    if (!newUser)
        res.render("register.ejs", { authError: "Can't register. Try different username" });
    const accessToken = jwt.sign({id: newUser.id, name: newUser.name}, process.env.SECRET_KEY, {expiresIn: '24h'});
    res.cookie('accessToken', accessToken, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 86400000});
    res.redirect("/");
});
app.post("/login", async (req, res) => {
    const user = await loginUser(req.body.name, req.body.password);
    // console.log(user);
    if (!user)
        return res.render("login.ejs", { authError: "Can't login. Incorrect username or password" });
    const accessToken = jwt.sign({id: user.id, name: user.name}, process.env.SECRET_KEY, {expiresIn: '24h'});

    res.cookie('accessToken', accessToken, {httpOnly: true, secure: true, sameSite: 'strict', maxAge: 86400000});
    res.redirect("/");
});

app.get("/logout", (req, res) => {
    res.clearCookie("accessToken");
    res.redirect("/login");
});

app.get("/new", async (req,res)=>{
    const newbook = req.query;
    // console.log(newbook.title);
    if (newbook.title){
        const b = new Book(newbook.title, newbook.author_name, newbook.first_publish_year,newbook.cover_id);
        return res.render("new.ejs", { user: req.user, book: newbook });
    }
    return res.redirect("/");
});

app.post("/new", async (req,res)=>{
    try {
        const { title, author_name, first_publish_year, cover_id, review, rating, read_date } = req.body;
        const b = new Book(title, author_name, first_publish_year, cover_id);
        const bookId = await b.add();

        const entry = new UserBooks({
            user_id: req.user.id, 
            book_id: bookId, 
            review : review || null, 
            rating : rating || null, 
            read_date : read_date || null
        }
        );
        await entry.add();

        res.redirect("/");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error when saving");
    }
});

app.get("/edit", async (req,res)=>{
    const id = req.query.id;
    return res.render("edit.ejs", { user: req.user, entry: req.userBooks.find(x => x.id == id) });

});

app.post("/edit", async (req,res)=>{
    try {
        const {review, rating, read_date, id } = req.body;

        const entry = new UserBooks({
            review: review || null, 
            rating: rating || null, 
            read_date: read_date || null,
            id: id}
        );
        await entry.edit();

        res.redirect("/");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error when saving");
    }
});

app.post("/delete", async (req,res)=>{
    const del_id = req.body.id;
    new UserBooks({id:del_id}).del();
    res.redirect("/");
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

async function registerUser(name, password) {
    try {
        const result = await db.query(`
            Insert into users (name, password)
            values ($1, crypt($2, gen_salt('bf')))
            RETURNING id, name;`, [name, password]);
        return result.rows[0];
    } catch (err) {
        console.error("Registration error:", err);
        return null;
    }
}

async function loginUser(name, password) {
    try {
        const result = await db.query(`
            Select id, name from users
            where name = $1 and password = crypt($2, password);`, [name, password]);
        return result.rows[0];

    } catch (err) {
        console.error("error logging in user");
        return null;
    }
}

async function searchBooks(searchTerm) {
    try {
        const result = await axios.get(`https://openlibrary.org/search.json?title=${searchTerm}&limit=10`);
        return result.data.docs;
    } catch (err) {
        console.log("Error why fetching books from search term");
        return null;
    }
}