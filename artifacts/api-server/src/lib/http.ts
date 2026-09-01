import type { Response } from "express";

export function sendError(
  res: Response,
  status: number,
  error: string,
  message: string,
) {
  res.status(status).json({ error, message });
}

export function sendValidationError(res: Response, error: unknown) {
  const issues = (error as { issues?: Array<{ message?: string }> }).issues;
  sendError(
    res,
    400,
    "validation_error",
    issues?.[0]?.message ?? "Invalid request",
  );
}

export function requireUuid(
  res: Response,
  value: string,
  name: string,
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    sendError(res, 400, "invalid_id", `${name} must be a valid UUID`);
    return false;
  }

  return true;
}