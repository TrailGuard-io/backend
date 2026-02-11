import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import crypto from "crypto";

const prisma = new PrismaClient();

const getNameFromProfile = (profile: { displayName?: string; name?: any }) => {
  if (profile.displayName) return profile.displayName;
  const first = profile.name?.givenName || profile.name?.firstName || "";
  const last = profile.name?.familyName || profile.name?.lastName || "";
  const combined = `${first} ${last}`.trim();
  return combined || undefined;
};

const ensureOAuthUser = async (
  provider: string,
  providerAccountId: string,
  {
    email,
    name,
    avatar,
  }: { email?: string | null; name?: string; avatar?: string | null }
) => {
  const existingAccount = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId,
      },
    },
    include: { user: true },
  });

  if (existingAccount) return existingAccount.user;

  let user = email
    ? await prisma.user.findUnique({ where: { email } })
    : null;

  if (!user) {
    if (!email) {
      throw new Error("Email not provided by provider");
    }
    const randomPassword = crypto.randomBytes(24).toString("hex");
    const hashed = await bcrypt.hash(randomPassword, 10);
    user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name: name || undefined,
        avatar: avatar || undefined,
      },
    });
  } else {
    const updates: Record<string, string> = {};
    if (!user.name && name) updates.name = name;
    if (!user.avatar && avatar) updates.avatar = avatar;
    if (Object.keys(updates).length > 0) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: updates,
      });
    }
  }

  await prisma.oAuthAccount.create({
    data: {
      provider,
      providerAccountId,
      userId: user.id,
    },
  });

  return user;
};

const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${backendUrl}/api/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const avatar = profile.photos?.[0]?.value;
          const name = getNameFromProfile(profile);
          const user = await ensureOAuthUser("google", profile.id, {
            email,
            name,
            avatar,
          });
          done(null, user);
        } catch (error) {
          done(error as Error);
        }
      }
    )
  );
}

if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_CLIENT_ID,
        clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
        callbackURL: `${backendUrl}/api/auth/facebook/callback`,
        profileFields: ["id", "emails", "name", "displayName", "photos"],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const avatar = profile.photos?.[0]?.value;
          const name = getNameFromProfile(profile);
          const user = await ensureOAuthUser("facebook", profile.id, {
            email,
            name,
            avatar,
          });
          done(null, user);
        } catch (error) {
          done(error as Error);
        }
      }
    )
  );
}

export default passport;
