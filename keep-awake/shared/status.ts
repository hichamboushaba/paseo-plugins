import { defineRpc, type RpcOutput } from "@getpaseo/plugin";
import { z } from "zod";

export const statusRpc = defineRpc({
  name: "keep-awake.status",
  input: z.object({}),
  output: z.object({
    platform: z.string(),
    supported: z.boolean(),
    holding: z.boolean(),
    heldBy: z.array(z.string()),
    holdReason: z.string().nullable(),
    command: z.string().nullable(),
    commandError: z.string().nullable(),
  }),
});

export type KeepAwakeStatus = RpcOutput<typeof statusRpc>;
