import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sendError } from "./lib/http";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((_req, res) => {
  sendError(res, 404, "not_found", "Route not found");
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  logger.error({ err: error }, "Unhandled request error");
  sendError(res, 500, "internal_error", "An unexpected error occurred");
};

app.use(errorHandler);

export default app;
