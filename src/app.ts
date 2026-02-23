import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import authRoutes from "./routes/auth";
import locationRoutes from "./routes/locations";
import walkRoutes from "./routes/walks";
import meRoutes from "./routes/me";
import searchRoutes from "./routes/search";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRoutes);
app.use("/locations", locationRoutes);
app.use("/walks", walkRoutes);
app.use("/me", meRoutes);
app.use("/search", searchRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const error = err as Error;
  if (error.name === "ZodError") {
    res.status(400).json({ error: "validation_failed", detail: error.message });
    return;
  }

  res.status(500).json({ error: "internal_server_error", detail: error.message });
});
