# Scale and stability notes

## Changed in this pass (no feature or response-shape changes)
- `middlewares/rateLimitMiddleware.js`: expired per-IP buckets are now swept every minute. Before, the Map grew by one entry per distinct IP forever (slow memory leak -> eventual crash).
- `utils/ttlCache.js` + the four public directory endpoints (hospitals, ambulances, blood banks, NGOs): the verified list is identical for every user, so it is loaded once per 60 s and shared; simultaneous requests share one DB query. Distances are still computed per request.
- `models/formModel.js`: added `{donorId, createdAt:-1}` and `{seekerId, createdAt:-1}` indexes on requests (history and request lists sorted newest-first per user). Indexes build in the background on first start; on a very large production collection, build them during a quiet period.
- History (`/history` activity) and the donor request list are capped at the newest 500 / 300 rows; history reads use `.lean()`.
- `server.js`: keep-alive timeouts above typical load-balancer timeouts (avoids random 502s), graceful shutdown on SIGTERM/SIGINT, unhandled promise rejections are logged instead of risking a crash, and `RUN_BACKGROUND_JOBS=false` turns off the three cron jobs on extra instances.

## Multi-instance support (added; off until you configure it)
Single instance with no Redis behaves exactly as before. To run several instances:
1. Provision a Redis (managed: Upstash / Redis Cloud / ElastiCache) and set `REDIS_URL` on every instance. Run `npm install` (adds `ioredis` and `@socket.io/redis-adapter`).
2. Socket.IO rooms, emits and presence then span all instances (`services/presence.js`: "is the user / chat room live" asks the whole cluster, so a user online on instance B is never treated as offline by instance A). The app connects over websocket only, so the load balancer does NOT need sticky sessions; it must support WebSocket upgrades and long-lived connections.
3. The rate limiter counts in Redis (shared limit across instances). If Redis is down, each instance counts in memory; requests are never blocked by a Redis outage.
4. Set `RUN_BACKGROUND_JOBS=false` on every instance except one (the 3 cron jobs). The request-flow scheduler and the call-expiry sweeper are safe on all instances.
5. Point the load balancer health check at `GET /ready` (503 while MongoDB is down or the instance is draining for a restart); `/health` stays a plain liveness check.
6. Mongo pool is `MONGO_MAX_POOL_SIZE` (default 200) per instance: instances x pool must stay under your MongoDB plan's connection limit.

## Abuse protection added
Per-account and per-IP limits on signup, login, OTP verify/resend, forgot/reset password and phone OTP (`routes/authRouter.js`). Per-IP limits are generous because many mobile users share a carrier-NAT address; per-account limits stop OTP brute force (10 tries / 10 min) and SMS/email cost abuse (5 sends / 10 min). Trade-off: someone can deliberately burn a victim's 10 login attempts for 15 minutes; that is the usual cost of per-account limits.
Request bodies are capped at 1 MB except routes that receive photos (`/forms /user /chat /upload /admin /support`, 10 MB). Override with `JSON_BODY_LIMIT`.

## Already fine / corrections
- Photos are uploaded to Cloudinary already (the local-disk code in `utils/imageUpload.js` is legacy cleanup only), so no shared-storage change is needed. Only old files still in `public/images` live on disk: copy that folder to every instance, or migrate them to Cloudinary.

## Not verified here
The Redis paths (adapter, Redis limiter) are covered by unit tests against fakes but have NOT been run against a real Redis or with two real instances. Before launch: start two instances behind one balancer, connect two phones to different instances and confirm chat, calls, typing and "online" status work between them; then run a load test (k6/Artillery) against staging.
