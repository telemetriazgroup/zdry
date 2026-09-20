import {
  applyZdryRefReplace,
  canPublishOdooRef,
  isZdryRefAttachment,
  pickZdryRefIdsToUnlink,
  planNineSlotsOneRef,
  zdryRefAttachmentName,
  plainChatterBody,
  zdryRefMessageBody,
  zdryRefMessagePostKw,
  zdryRefSearchDomain,
  type ZdryRefAttachment,
} from "./odoo-ref-photo";

const ISO = "BMOU433548-9";

describe("zdry_ref naming", () => {
  it("nombra el adjunto con el ISO y la marca", () => {
    expect(zdryRefAttachmentName(ISO)).toBe("zdry_ref_BMOU433548-9.jpg");
    expect(isZdryRefAttachment({ name: zdryRefAttachmentName(ISO), description: "zdry_ref" })).toBe(true);
    expect(isZdryRefAttachment({ name: "chatter-01.jpg", description: "inbox" })).toBe(false);
  });

  it("busca por nombre (el chatter mueve el adjunto a mail.message)", () => {
    expect(zdryRefSearchDomain(1842, ISO)).toEqual([
      "|",
      ["name", "=", "zdry_ref_BMOU433548-9.jpg"],
      "&",
      "&",
      ["description", "=", "zdry_ref"],
      ["res_model", "=", "stock.lot"],
      ["res_id", "=", 1842],
    ]);
  });
});

describe("zdryRefMessagePostKw", () => {
  it("el mensaje es texto plano: Odoo escapa <p> y se ve la etiqueta", () => {
    expect(zdryRefMessagePostKw("<p>hola</p>", 909)).toEqual({
      body: "hola",
      message_type: "comment",
      attachment_ids: [909],
    });
  });
});

describe("plainChatterBody", () => {
  it("quita el <p> que el chatter muestra literal", () => {
    expect(plainChatterBody("<p>Referencia fotográfica ZDRY actualizada (APHU6789309, casilla 3: Lateral izquierdo).</p>")).toBe(
      "Referencia fotográfica ZDRY actualizada (APHU6789309, casilla 3: Lateral izquierdo).",
    );
  });
});

describe("replace leaves one zdry_ref", () => {
  it("tras dos reemplazos queda un solo adjunto, el último", () => {
    let store: ZdryRefAttachment[] = [
      { id: 10, name: "foto-historica.jpg", description: "" },
    ];
    store = applyZdryRefReplace(store, {
      id: 101,
      name: zdryRefAttachmentName(ISO),
      description: "zdry_ref",
    });
    store = applyZdryRefReplace(store, {
      id: 202,
      name: zdryRefAttachmentName(ISO),
      description: "zdry_ref",
    });
    const refs = store.filter(isZdryRefAttachment);
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe(202);
    expect(store.some((a) => a.id === 10)).toBe(true);
  });

  it("no unlink el id recién creado", () => {
    expect(
      pickZdryRefIdsToUnlink(
        [
          { id: 101, name: "zdry_ref_X.jpg", description: "zdry_ref" },
          { id: 202, name: "zdry_ref_X.jpg", description: "zdry_ref" },
        ],
        202,
      ),
    ).toEqual([101]);
  });
});

describe("nine slots one upload", () => {
  it("9 fotos de patio → 1 subida, 8 se quedan en ZDRY", () => {
    expect(planNineSlotsOneRef(9)).toEqual({ uploads: 1, staysInZdry: 8 });
    expect(planNineSlotsOneRef(0)).toEqual({ uploads: 0, staysInZdry: 0 });
  });
});

describe("canPublishOdooRef", () => {
  it("rechaza fotos que bajaron del chatter", () => {
    expect(canPublishOdooRef({ source: "odoo" })).toMatchObject({ ok: false });
    expect(canPublishOdooRef({ source: "zdry" }).ok).toBe(true);
    expect(canPublishOdooRef(null).ok).toBe(false);
  });
});

describe("zdryRefMessageBody", () => {
  it("un solo texto, no un hilo por toma", () => {
    expect(zdryRefMessageBody(ISO, 0, "Frontal (puertas)")).toBe(
      "Referencia fotográfica ZDRY actualizada (BMOU433548-9, casilla 1: Frontal (puertas)).",
    );
  });
});
