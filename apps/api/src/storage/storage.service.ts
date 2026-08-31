import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger(StorageService.name);
  private readonly bucket = process.env.MINIO_BUCKET || "zdry";
  private readonly s3 = new S3Client({
    region: process.env.MINIO_REGION || "us-east-1",
    endpoint: process.env.MINIO_ENDPOINT || "http://localhost:9000",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || "zdry",
      secretAccessKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || "zdryminio",
    },
  });

  async onModuleInit() {
    await this.ensureBucket();
  }

  private async ensureBucket() {
    for (let i = 0; i < 12; i++) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
        return;
      } catch (err) {
        const name = (err as { name?: string }).name || "";
        if (name === "NotFound" || name === "NoSuchBucket") {
          await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
          this.log.log(`Bucket MinIO creado: ${this.bucket}`);
          return;
        }
        this.log.warn(`MinIO no listo (${i + 1}/12): ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    this.log.error("No se pudo contactar MinIO; las subidas fallarán hasta que esté disponible.");
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      stream: out.Body as Readable,
      contentType: out.ContentType,
      contentLength: out.ContentLength,
    };
  }

  async getBuffer(key: string): Promise<{ buffer: Buffer; contentType?: string }> {
    const obj = await this.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of obj.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return { buffer: Buffer.concat(chunks), contentType: obj.contentType };
  }

  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
