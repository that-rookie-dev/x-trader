import { Decimal } from "decimal.js";
import { z } from "zod";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "invalid decimal")
  .refine((value) => Number.isFinite(Number(value)), "non-finite decimal");

export type DecimalString = z.infer<typeof decimalStringSchema>;

export function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function money(value: Decimal.Value, places = 2): DecimalString {
  return d(value).toFixed(places);
}

export function assertPositive(value: Decimal.Value, label: string): Decimal {
  const n = d(value);
  if (n.lte(0)) {
    throw new Error(`${label} must be > 0`);
  }
  return n;
}

export { Decimal };
