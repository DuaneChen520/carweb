export * from "./1_15/index.js";
export * from "./1_15_1.js";
export * from "./1_16.js";
export * from "./1_17/index.js";
export * from "./1_18/index.js";
export * from "./1_19.js";
export * from "./1_20.js";
export * from "./1_21/index.js";
export * from "./1_22/index.js";
export * from "./1_23/index.js";
export * from "./1_24/index.js";
export * from "./1_25/index.js";
export * from "./2_0/index.js";
export * from "./2_1/index.js";
export * from "./2_1_1.js";
export * from "./2_2/index.js";
export * from "./2_3/index.js";
export * from "./2_3_1.js";
export * from "./2_4/index.js";
export * from "./2_5.js";
export * from "./2_6/index.js";
export * from "./2_6_1.js";
export * from "./2_7/index.js";
export * from "./3_0/index.js";
export * from "./3_0_1.js";
export * from "./3_0_2.js";
export * from "./3_1/index.js";
export * from "./3_2/index.js";
export * from "./3_3.js";
export * from "./3_3_1/index.js";
export * from "./3_3_2.js";
export * from "./3_3_3.js";
export * from "./3_3_4.js";
export * from "./4_0.js";
export * from "./android/index.js";
export * from "./base/index.js";
export * from "./control/index.js";
export * from "./latest.js";
export * from "./utils/index.js";
export * from "./video/index.js";
import * as H264 from "../../media-codec/esm/h264.js";
import * as H265 from "../../media-codec/esm/h265.js";
import {
    Av1,
    AndroidAv1Profile,
    AndroidAv1Level,
} from "../../media-codec/esm/index.js";

export function h264ParseConfiguration(data: Uint8Array) {
    return H264.parseConfiguration(data);
}
export function h264ToCodecString(
    configuration: ReturnType<typeof H264.parseConfiguration>,
) {
    return H264.toCodecString(configuration);
}
export function h265ParseConfiguration(data: Uint8Array) {
    return H265.parseConfiguration(data);
}
export function h265ToCodecString(
    configuration: ReturnType<typeof H265.parseConfiguration>,
) {
    return H265.toCodecString(configuration);
}
export { Av1, AndroidAv1Profile, AndroidAv1Level };

// H.264 Profile/Level constants used by published @yume-chan/scrcpy consumers
export const AndroidAvcProfile = {
    Baseline: 66,
    Main: 77,
    Extended: 88,
    High: 100,
    High10: 110,
    High422: 122,
    High444: 244,
} as const;

export const AndroidAvcLevel = {
    Level1: 10,
    Level1b: 11,
    Level11: 11,
    Level12: 12,
    Level13: 13,
    Level2: 20,
    Level21: 21,
    Level22: 22,
    Level3: 30,
    Level31: 31,
    Level32: 32,
    Level4: 40,
    Level41: 41,
    Level42: 42,
    Level5: 50,
    Level51: 51,
} as const;

export type AndroidAvcProfile =
    (typeof AndroidAvcProfile)[keyof typeof AndroidAvcProfile];

export type AndroidAvcLevel =
    (typeof AndroidAvcLevel)[keyof typeof AndroidAvcLevel];

