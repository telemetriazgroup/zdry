/**
 * Wikimedia Commons photos used only for the demo catalog.
 * Licenses: CC BY-SA. Attribution is stored on each unit's inspection notes.
 * Fetched at load time with a descriptive User-Agent (Wikimedia policy).
 */
export type DemoPhotoSource = {
  file: string;
  credit: string;
  license: string;
};

export const WIKIMEDIA_UA =
  "ZDRY-Demo/1.0 (https://zdry.pe; demo dataset for maritime-container ERP; ops@zdry.pe)";

/** Close-ups and yard shots that read as inspection / patio inventory. */
export const DEMO_PHOTO_SOURCES: DemoPhotoSource[] = [
  {
    file: "Barbados_Port_Inc_Container_Park_Bridgetown_0251.jpg",
    credit: "Paul Harrison",
    license: "CC BY-SA 4.0",
  },
  {
    file: "Port_of_Singapore_Keppel_Terminal.jpg",
    credit: "Calvin Teo",
    license: "CC BY-SA 2.5",
  },
  {
    file: "Container-Terminal-Altenwerder-CTA-2004.jpg",
    credit: "Wiki-observer",
    license: "CC BY-SA 3.0",
  },
  {
    file: "Red_Hook_Container_Terminal_New_York_September_2016_001.jpg",
    credit: "Jim.henderson",
    license: "CC BY-SA 4.0",
  },
  {
    file: "Gdynia_BCT_34.jpg",
    credit: "Andrzej Otrębski",
    license: "CC BY-SA 4.0",
  },
  {
    file: "Container_01_KMJ.jpg",
    credit: "KMJ",
    license: "CC BY-SA 3.0",
  },
  {
    file: "Blue_and_grey_shipping_containers.jpg",
    credit: "Wikimedia Commons",
    license: "CC BY-SA",
  },
  {
    file: "20_Foot_Shipping_Container_Storage_Yard.jpg",
    credit: "Wikimedia Commons",
    license: "CC BY-SA",
  },
  {
    file: "SITC_and_other_shipping-containers.jpg",
    credit: "Wikimedia Commons",
    license: "CC BY-SA",
  },
];

export type FetchedPhoto = {
  buffer: Buffer;
  mime: string;
  ext: string;
  originalName: string;
  credit: string;
  license: string;
};

type CommonsImageInfo = {
  thumburl?: string;
  url?: string;
  mime?: string;
  size?: number;
};

export async function fetchCommonsThumb(source: DemoPhotoSource, width = 1280): Promise<FetchedPhoto | null> {
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
    "&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=" +
    width +
    "&titles=" +
    encodeURIComponent("File:" + source.file);
  const headers = { "User-Agent": WIKIMEDIA_UA, Accept: "application/json" };
  try {
    const metaRes = await fetch(api, { headers, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as {
      query?: { pages?: Record<string, { imageinfo?: CommonsImageInfo[] }> };
    };
    const page = Object.values(meta.query?.pages || {})[0];
    const info = page?.imageinfo?.[0];
    const fileUrl = info?.thumburl || info?.url;
    if (!fileUrl) return null;
    const imgRes = await fetch(fileUrl, {
      headers: { "User-Agent": WIKIMEDIA_UA },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!imgRes.ok) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length < 8_000 || buf.length > 8_000_000) return null;
    const mime = info?.mime || imgRes.headers.get("content-type") || "image/jpeg";
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    return {
      buffer: buf,
      mime,
      ext,
      originalName: source.file,
      credit: source.credit,
      license: source.license,
    };
  } catch {
    return null;
  }
}

export async function fetchDemoPhotoSet(): Promise<FetchedPhoto[]> {
  const results = await Promise.all(DEMO_PHOTO_SOURCES.map((src) => fetchCommonsThumb(src)));
  return results.filter((p): p is FetchedPhoto => !!p);
}

export function photoCreditLine(photos: FetchedPhoto[]): string {
  if (!photos.length) return "";
  const uniq = [...new Map(photos.map((p) => [p.originalName, p])).values()];
  return (
    "Fotos de demostración (Wikimedia Commons). " +
    uniq.map((p) => `${p.originalName} — ${p.credit} (${p.license})`).join("; ") +
    ". No corresponden a esta unidad física."
  );
}
