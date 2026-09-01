import type { NextFunction, Request, Response } from "express";
import { sendError } from "./http";

function getPresentedApiKey(req: Request) {
  const authorization = req.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }
  return req.get("x-api-key")?.trim();
}

export function requireSaveArticleApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const configuredKey = process.env["SAVE_ARTICLE_API_KEY"]?.trim();
  if (!configuredKey) {
    sendError(
      res,
      503,
      "api_key_not_configured",
      "SAVE_ARTICLE_API_KEY is not configured",
    );
    return;
  }

  if (getPresentedApiKey(req) !== configuredKey) {
    res.setHeader("WWW-Authenticate", "Bearer");
    sendError(res, 401, "unauthorized", "A valid API key is required");
    return;
  }

  next();
}