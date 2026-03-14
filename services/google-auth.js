// Google OAuth2 service for Google Ads + Analytics
const { findOne, insert, update } = require("../db/database");

const SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/tagmanager.readonly",
  "openid", "email", "profile",
];

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error("Falha ao trocar código Google: " + (await res.text()));
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("Falha ao renovar token Google");
  return res.json();
}

async function getUserInfo(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.json();
}

function saveTokens(userId, platform, tokens) {
  const existing = findOne("oauth_tokens", t => t.user_id === userId && t.platform === platform);
  if (existing) {
    update("oauth_tokens", t => t.id === existing.id, () => ({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || existing.refresh_token,
      expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
      scope: tokens.scope || existing.scope,
    }));
  } else {
    insert("oauth_tokens", {
      user_id: userId,
      platform,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
      scope: tokens.scope || "",
    });
  }
}

async function getValidToken(userId, platform) {
  const tok = findOne("oauth_tokens", t => t.user_id === userId && t.platform === platform);
  if (!tok) return null;
  if (Date.now() > tok.expires_at - 60000 && tok.refresh_token) {
    const fresh = await refreshAccessToken(tok.refresh_token);
    saveTokens(userId, platform, fresh);
    return fresh.access_token;
  }
  return tok.access_token;
}

module.exports = { getAuthUrl, exchangeCode, refreshAccessToken, getUserInfo, saveTokens, getValidToken };
