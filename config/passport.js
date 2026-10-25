const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const userModel = require("../models/userMode");
const { sendTemplate } = require("../email-sender/mailer");
const dotenv = require("dotenv");

dotenv.config();

// Google serves the avatar as a small (=s96-c) thumbnail by default. Ask for a
// larger square crop so it stays sharp in big avatars (profile header etc.).
// Returns "" when Google didn't send a usable photo.
const getGooglePhotoUrl = (profile) => {
  const raw = profile && profile.photos && profile.photos[0] && profile.photos[0].value;
  if (!raw || typeof raw !== "string" || !/^https:\/\//i.test(raw)) return "";
  return raw.replace(/=s\d+(-c)?$/i, "=s400-c");
};

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? `${process.env.BACKEND_SERVER}/api/auth/google/callback`
          : `${process.env.BACKEND_SERVER || "http://localhost:5000"}/api/auth/google/callback`,
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;

        let user = await userModel.findOne({ email: email });

        const googlePhoto = getGooglePhotoUrl(profile);

        if (user) {
          let dirty = false;
          if (!user.googleId) {
            user.googleId = profile.id;
            user.isVerified = true;
            dirty = true;
          }
          // Photo precedence (single canonical field: user.profilePicture):
          //   1. an existing photo (user-uploaded OR a previously saved Google
          //      one) is NEVER overwritten by a later Google sign-in;
          //   2. only when the account has no photo yet do we persist the
          //      Google photoURL — this also back-fills Google accounts that
          //      were created before the photo was being stored.
          if (!user.profilePicture && googlePhoto) {
            user.profilePicture = googlePhoto;
            dirty = true;
          }
          if (dirty) await user.save();
          return done(null, user);
        }

        user = await userModel.create({
          name: profile.displayName,
          email: email,
          profilePicture: googlePhoto,
          googleId: profile.id,
          isVerified: true,
        });

        // Brand-new Google account: send the welcome email (fire-and-forget).
        // The flag (plain JS property, not saved) tells the callback route to
        // skip the "you signed in" alert for this very first sign-in.
        user.isNewGoogleUser = true;
        sendTemplate(user.email, "welcome", { name: user.name }, "en");
        require("../controllers/notificationController").createNotification({
          userId: user._id,
          title: "Welcome to Blood Donation",
          message: "Your account is ready. Find donors, post an emergency request, or register as a donor to help save lives.",
          link: "/(tabs)/home",
          emailCopy: false,
        });

        return done(null, user);
      } catch (err) {
        console.error("Passport Google Strategy Error:", err);
        return done(err, null);
      }
    },
  ),
);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await userModel.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
