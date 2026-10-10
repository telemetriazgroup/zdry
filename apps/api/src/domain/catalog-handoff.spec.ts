import { handoffMessage } from "./catalog-handoff";

const base = {
  contactName: "Brayan",
  typeLabel: "40' High Cube",
  iso: "BMOU4347690",
  catLabel: "As Is",
  year: 2010,
  depotName: "Gambeta 2",
  manufacturer: "HOU",
  url: "https://zdry.local/zdry/e/abc",
};

describe("handoffMessage", () => {
  it("incluye el precio de lista solo si el comercial lo marca", () => {
    const withPrice = handoffMessage({ ...base, includePrice: true, priceList: 1680 });
    const hidden = handoffMessage({ ...base, includePrice: false, priceList: 1680 });
    expect(withPrice).toContain("USD 1680");
    expect(withPrice).toContain("https://zdry.local/zdry/e/abc");
    expect(hidden).not.toContain("1680");
    expect(hidden).not.toMatch(/mínimo/i);
  });
});
