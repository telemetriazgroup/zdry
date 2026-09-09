import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origin = process.env.WEB_ORIGIN || "http://localhost:28080";
  const expressApp = app.getHttpAdapter().getInstance();
  if (expressApp?.set) expressApp.set("trust proxy", 1);
  app.use(cookieParser());
  app.enableCors({ origin: origin.split(",").map((s) => s.trim()).filter(Boolean), credentials: true });
  const port = Number(process.env.API_PORT || 3003);
  await app.listen(port, "0.0.0.0");
}

bootstrap();
