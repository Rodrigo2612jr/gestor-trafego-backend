// Meta (Facebook/Instagram) OAuth2 service
const { findOne, insert, update } = require("../db/database");

const SCOPES = ["ads_management", "ads_read", "business_management", "pages_read_engagement", "instagram_basic"];

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(","),
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

async function exchangeCode(code) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: process.env.META_REDIRECT_URI,
    code,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params}`);
  if (!res.ok) throw new Error("Falha ao trocar código Meta: " + (await res.text()));
  return res.json();
}

async function getLongLivedToken(shortToken) {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params}`);
  if (!res.ok) throw new Error("Falha ao obter token longo Meta");
  return res.json();
}

async function getUserInfo(accessToken) {
  const res = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`);
  return res.json();
}

function saveTokens(userId, tokens) {
  const existing = findOne("oauth_tokens", t => t.user_id === userId && t.platform === "meta");
  if (existing) {
    update("oauth_tokens", t => t.id === existing.id, () => ({
      access_token: tokens.access_token,
      expires_at: Date.now() + (tokens.expires_in || 5184000) * 1000,
    }));
  } else {
    insert("oauth_tokens", {
      user_id: userId,
      platform: "meta",
      access_token: tokens.access_token,
      refresh_token: null,
      expires_at: Date.now() + (tokens.expires_in || 5184000) * 1000,
      scope: SCOPES.join(","),
    });
  }
}

function getToken(userId) {
  const tok = findOne("oauth_tokens", t => t.user_id === userId && t.platform === "meta");
  if (!tok || Date.now() > tok.expires_at) return null;
  return tok.access_token;
}

module.exports = { getAuthUrl, exchangeCode, getLongLivedToken, getUserInfo, saveTokens, getToken };
