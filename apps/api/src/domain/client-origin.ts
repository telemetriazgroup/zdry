import { Request } from "express";

export type ClientOrigin = {
  ip: string;
  userAgent: string;
  referer: string;
  originHost: string;
  acceptLanguage: string;
  forwardedFor: string;
  extra: Record<string, string>;
};

function header(req: Request, name: string) {
  const v = req.headers[name];
  if (Array.isArray(v)) return String(v[0] || "").trim();
  return String(v || "").trim();
}

export function clientOrigin(req: Request): ClientOrigin {
  const forwardedFor = header(req, "x-forwarded-for");
  const realIp = header(req, "x-real-ip") || header(req, "cf-connecting-ip");
  const firstForwarded = forwardedFor.split(",")[0]?.trim() || "";
  const socketIp = req.ip || req.socket?.remoteAddress || "";
  const ip = (firstForwarded || realIp || socketIp || "unknown").replace(/^::ffff:/, "");
  return {
    ip,
    userAgent: header(req, "user-agent").slice(0, 800),
    referer: header(req, "referer") || header(req, "referrer"),
    originHost: header(req, "origin") || header(req, "x-forwarded-host") || header(req, "host"),
    acceptLanguage: header(req, "accept-language").slice(0, 200),
    forwardedFor: forwardedFor.slice(0, 400),
    extra: {
      proto: header(req, "x-forwarded-proto"),
      cfConnectingIp: header(req, "cf-connecting-ip"),
      secChUa: header(req, "sec-ch-ua"),
      secChUaMobile: header(req, "sec-ch-ua-mobile"),
      secChUaPlatform: header(req, "sec-ch-ua-platform"),
    },
  };
}

export const PUBLIC_VISIT_LIMITS = {
  submit: { burst: { ttl: 20, max: 4 }, window: { ttl: 900, max: 8 }, plates: { ttl: 3600, max: 6 } },
  photo: { burst: { ttl: 20, max: 5 }, window: { ttl: 900, max: 12 } },
  lookup: { burst: { ttl: 15, max: 20 }, window: { ttl: 900, max: 60 } },
} as const;

export type PublicVisitAction = keyof typeof PUBLIC_VISIT_LIMITS;
