const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const userModel = require("../models/userMode");
const dotenv = require("dotenv");

dotenv.config();

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

        if (user) {
          if (!user.googleId) {
            user.googleId = profile.id;
            user.isVerified = true;
            if (!user.profilePicture)
              user.profilePicture = profile.photos[0].value;
            await user.save();
          }
          return done(null, user);
        }

        user = await userModel.create({
          name: profile.displayName,
          email: email,
          profilePicture: profile.photos[0].value,
          googleId: profile.id,
          isVerified: true,
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
