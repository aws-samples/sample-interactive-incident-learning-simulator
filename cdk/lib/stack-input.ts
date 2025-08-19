import { z } from "zod";

export const stackInputSchema = z.object({
  env: z
    .object({
      account: z.string().optional(),
      region: z.string().optional(),
    })
    .optional(),
  // For WAF
  // TODO: Create WAF construct
  allowedIpV4AddressRanges: z
    .string()
    .cidr({ version: "v4" })
    .array()
    .nullish(),
  allowedIpV6AddressRanges: z
    .string()
    .cidr({ version: "v6" })
    .array()
    .nullish(),
  allowedCountryCodes: z.array(z.string()).nullish(),
});

export type StackInput = z.infer<typeof stackInputSchema>;
