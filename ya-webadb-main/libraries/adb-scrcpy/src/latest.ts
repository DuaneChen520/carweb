import { AdbScrcpyOptions4_0 } from "./4_0.js";
import type { AdbScrcpyClientOptions } from "./client-options.js";

export class AdbScrcpyOptionsLatest<
    TVideo extends boolean,
> extends AdbScrcpyOptions4_0<TVideo> {
    constructor(
        init: AdbScrcpyOptions4_0.Init<TVideo>,
        clientOptions?: AdbScrcpyClientOptions,
    ) {
        super(init, clientOptions);
    }
}

export namespace AdbScrcpyOptionsLatest {
    export type Init<TVideo extends boolean = boolean> =
        AdbScrcpyOptions4_0.Init<TVideo>;
}
