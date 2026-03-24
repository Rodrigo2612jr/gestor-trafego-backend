const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  // Allow token via query param for debug endpoints (browser-accessible)
  const rawToken = (header && header.startsWith("Bearer ") ? header.slice(7) : null)
    || req.query.token
    || null;

  if (!rawToken) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  const token = rawToken;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

module.exports = authMiddleware;
