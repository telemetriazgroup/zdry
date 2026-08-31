/** Cuentas de cobro ZDRY. El cliente paga por transferencia y sube el voucher (no hay pasarela). */

export type PaymentAccount = {
  bank: string;
  currency: string;
  account: string;
  cci: string;
  holder: string;
};

export const DEFAULT_PAYMENT_ACCOUNTS: PaymentAccount[] = [
  {
    bank: "BCP",
    currency: "USD",
    account: "193-2345678-1-12",
    cci: "00219300234567811218",
    holder: "ZDRY S.A.C.",
  },
  {
    bank: "Interbank",
    currency: "USD",
    account: "200-3001234560",
    cci: "00320000300123456016",
    holder: "ZDRY S.A.C.",
  },
];

export type ClientProfile = {
  companyName?: string | null;
  rucDni?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
};

export function missingProfileFields(p: ClientProfile): string[] {
  const miss: string[] = [];
  if (!String(p.companyName || "").trim()) miss.push("empresa");
  if (!String(p.rucDni || "").trim()) miss.push("RUC/DNI");
  if (!String(p.contactName || "").trim()) miss.push("persona de contacto");
  if (!String(p.email || "").trim()) miss.push("correo");
  if (!String(p.phone || "").trim()) miss.push("teléfono");
  return miss;
}

export function profileComplete(p: ClientProfile): boolean {
  return missingProfileFields(p).length === 0;
}
