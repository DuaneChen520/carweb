import type { StructInit } from "@yume-chan/struct";
import { struct, u16, u8 } from "@yume-chan/struct";

export const ResizeDisplayControlMessage = struct(
    { 
        type: u8,
        width: u16, 
        height: u16 
    },
    { littleEndian: false },
);

export type ResizeDisplayControlMessage = StructInit<typeof ResizeDisplayControlMessage>;
