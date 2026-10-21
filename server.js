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
const initChatCleanupCron = require("./services/chatCleanupCron");
const initDonorAvailabilityCron = require("./services/donorAvailabilityCron");
const { initDonationLifecycleJobs } = require("./services/donationLifecycle/jobs");
const { startCallExpirySweeper } = require("./services/callLifecycleService");

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
// Only the routes that really receive photos (base64 data URIs) accept big bodies;
// everything else is capped at 1 MB so one oversized request can't tie up memory.
const bigJson = express.json({ limit: "10mb" });
const smallJson = express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" });
const BIG_BODY_PREFIXES = ["/forms", "/user", "/chat", "/upload", "/admin", "/support", "/our-heroes", "/api/our-heroes"];
app.use((req, res, next) => {
  const big = BIG_BODY_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + "/"));
  return (big ? bigJson : smallJson)(req, res, next);
});
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
// Readiness for load balancers / autoscalers: 503 while MongoDB is down or the server is
// draining for a restart, so traffic is routed to healthy instances only.
let draining = false;
app.use("/ready", (req, res) => {
  const dbUp = require("mongoose").connection.readyState === 1;
  if (draining || !dbUp) return res.status(503).json({ ready: false, db: dbUp, draining });
  res.status(200).json({ ready: true });
});

// Scheduled jobs. Default is ON everywhere (behaviour unchanged). When you run several
// server instances, set RUN_BACKGROUND_JOBS=false on all but ONE so the daily/15-minute
// cron jobs (chat cleanup, donor availability) don't run once per instance
// (duplicate notifications, wasted DB work). The donation-lifecycle worker (12 h expiry,
// 6-hourly reminders) and the call expiry sweeper claim work atomically, so they are safe to leave on every instance.
if (String(process.env.RUN_BACKGROUND_JOBS || "true").toLowerCase() !== "false") {
  initChatCleanupCron();
  initDonorAvailabilityCron();
}
// Durable 12-hour request expiry + "Mark Complete" reminders (services/donationLifecycle/).
initDonationLifecycleJobs();
// Durable ring-window expiry: unanswered calls (45 s) become "missed", across restarts.
startCallExpirySweeper();

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
// Our Heroes: admin-managed directory. Also exposed under /api for API consumers.
const ourHeroesRouter = require("./routes/ourHeroesRouter");
app.use("/our-heroes", ourHeroesRouter);
app.use("/api/our-heroes", ourHeroesRouter);
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

// Node closes idle keep-alive connections after 5 s, but load balancers (nginx, AWS ALB,
// Cloud Run...) keep them open ~60 s. The race shows up as random 502/"connection reset"
// errors under steady traffic. Keep Node's timeout longer than the balancer's.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);

// Deploys / autoscaling send SIGTERM: stop taking new connections, let in-flight requests
// finish, close MongoDB, then exit — instead of cutting users off mid-request. A hard
// exit after 10 s guarantees a stuck connection can never block a restart.
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  draining = true;
  console.log(`${signal} received — shutting down gracefully`);
  const force = setTimeout(() => process.exit(1), 10_000);
  if (typeof force.unref === "function") force.unref();
  io.close(() => {
    server.close(() => {
      Promise.allSettled([require("mongoose").connection.close(), require("./config/redis").closeAll()]).finally(() =>
        process.exit(0),
      );
    });
  });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// A stray rejected promise in one request handler must not take the whole server (and
// every other user's connection) down. Log it and keep serving. Genuine uncaught
// exceptions are left alone: the process exits and the supervisor restarts it clean.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
