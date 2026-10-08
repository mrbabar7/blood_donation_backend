const express = require("express");
require("dotenv").config();
const http = require("http");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const passport = require("passport");
// Gzips every JSON/text response before it goes over the wire. Pure
// bandwidth/latency win — same bytes in, same bytes out on the app side —
// so it needs no other change anywhere. Matters most once traffic grows:
// donor search results, directory listings, chat history, etc. all shrink
// substantially over the wire, which is exactly the kind of thing that
// keeps the app responsive as concurrent users scale up.
const compression = require("compression");

const db = require("./config/db");
require("./config/firebaseAdmin");
const { initSocket } = require("./services/socketService");
const initAutoRejectCron = require("./services/autoRejectService");
const initChatCleanupCron = require("./services/chatCleanupCron");

// Routes
const route = require("./routes/authRouter");
const addressRouter = require("./routes/addressRouter");
const userRouter = require("./routes/userRouter");
const donorRoutes = require("./routes/donorRoutes");
const seekerRouter = require("./routes/seekerRouter");
const historyRouter = require("./routes/historyRouter");
const googleSignup = require("./routes/googleSignup");
const formRoutes = require("./routes/formRouter");

require("./config/passport");

const app = express();
const server = http.createServer(app);

const io = initSocket(server);
app.set("io", io);

app.set("trust proxy", 1);
app.use(compression());
// Registration photos (hospital/NGO/blood bank/ambulance) travel as base64
// data URIs inside the normal JSON body. Express's default json limit is
// 100kb, which a photo blows past instantly — raised so uploads don't get
// silently rejected with a 413 before they ever reach the controller.
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// Serves the images saved by utils/imageUpload.js (directory-listing photos
// for hospitals/NGOs/blood banks/ambulances). Mounted ahead of the strict
// CORS check below and open to any origin — these are public listing photos
// (the same ones shown in the public discovery screens), not private data,
// and the mobile app's <Image> loader doesn't send an Origin header anyway.
app.use(
  "/images",
  cors(),
  express.static(path.join(__dirname, "public", "images"), {
    maxAge: "7d",
  }),
);

const { serveRedirects } = require("./middlewares/redirectMiddleware");
app.use(serveRedirects);

const allowedOrigins = [
  process.env.FRONTEND_URL_WEB,
  process.env.FRONTEND_URL_MOBILE,
  process.env.BACKEND_SERVER,
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        // Previously fell through to callback(null, true) here too, which
        // meant the allowlist above was checked but never actually enforced —
        // every origin was accepted regardless. Reject anything not in
        // allowedOrigins instead.
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

app.use(passport.initialize());

app.use("/health", (req, res) => {
  res.status(200).json({ message: "Health check passed!" });
});

initAutoRejectCron();
initChatCleanupCron();

app.use("/auth", route);
app.use("/addresses", addressRouter);
app.use("/user", userRouter);
app.use("/donors", donorRoutes);
app.use("/seeker", seekerRouter);
app.use("/history", historyRouter);
app.use("/notifications", donorRoutes);
app.use("/forms", formRoutes);
app.use("/chat", require("./routes/chatRouter"));
app.use("/upload", require("./routes/uploadRouter"));
app.use("/calls", require("./routes/callRouter"));
app.use("/reviews", require("./routes/reviewRouter"));
app.use("/stats", require("./routes/statsRouter"));
app.use("/regions", require("./routes/regionsPublicRouter"));
app.use("/admin", require("./routes/adminRouter"));
app.use("/support", require("./routes/supportRouter"));
app.use("/reservations", require("./routes/reservationRouter"));
app.use("/pages", require("./routes/publicPagesRouter"));
app.use("/announcements", require("./routes/announcementsPublicRouter"));
app.use("/", require("./routes/seoPublicRouter"));
app.use("/feature-flags", (req, res, next) => {
  if (req.method !== "GET") return next();
  require("./controllers/admin/featureFlagsController").getPublicFlags(
    req,
    res,
  );
});
app.use("/api/auth", googleSignup);

// Mounted last, after every real route — anything that reaches here is a
// genuine 404, logged for the admin Redirects & 404s screen.
const { log404 } = require("./middlewares/redirectMiddleware");
app.use(log404);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
