var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var _NaluSodbBitReader_instances, _NaluSodbBitReader_nalu, _NaluSodbBitReader_byteLength, _NaluSodbBitReader_stopBitIndex, _NaluSodbBitReader_zeroCount, _NaluSodbBitReader_bytePosition, _NaluSodbBitReader_bitPosition, _NaluSodbBitReader_byte, _NaluSodbBitReader_loadByte, _NaluSodbBitReader_checkSkipPosition, _NaluSodbBitReader_save, _NaluSodbBitReader_restore;
/**
 * Split NAL units from an H.264/H.265 Annex B stream.
 *
 * The input is not modified.
 * The returned NAL units are views of the input (no memory allocation nor copy),
 * and still contains emulation prevention bytes.
 *
 * This methods returns a generator, so it can be stopped immediately
 * after the interested NAL unit is found.
 */
export function* annexBSplitNalu(buffer) {
    // -1 means we haven't found the first start code
    let start = -1;
    // How many `0x00`s in a row we have counted
    let zeroCount = 0;
    let inEmulation = false;
    for (let i = 0; i < buffer.length; i += 1) {
        const byte = buffer[i];
        if (inEmulation) {
            if (byte > 0x03) {
                // `0x00000304` or larger are invalid
                throw new Error("Invalid data");
            }
            inEmulation = false;
            continue;
        }
        if (byte === 0x00) {
            zeroCount += 1;
            continue;
        }
        const prevZeroCount = zeroCount;
        zeroCount = 0;
        if (start === -1) {
            // 0x000001 is the start code
            // But it can be preceded by any number of zeros
            // So 2 is the minimal
            if (prevZeroCount >= 2 && byte === 0x01) {
                // Found start of first NAL unit
                start = i + 1;
                continue;
            }
            // Not begin with start code
            throw new Error("Invalid data");
        }
        if (prevZeroCount < 2) {
            // zero or one `0x00`s are acceptable
            continue;
        }
        if (byte === 0x01) {
            // Found another NAL unit
            yield buffer.subarray(start, i - prevZeroCount);
            start = i + 1;
            continue;
        }
        if (prevZeroCount > 2) {
            // Too much `0x00`s
            throw new Error("Invalid data");
        }
        switch (byte) {
            case 0x02:
                // Didn't find why, but 7.4.1 NAL unit semantics forbids `0x000002` appearing in NAL units
                throw new Error("Invalid data");
            case 0x03:
                // `0x000003` is the "emulation_prevention_three_byte"
                // `0x00000300`, `0x00000301`, `0x00000302` and `0x00000303` represent
                // `0x000000`, `0x000001`, `0x000002` and `0x000003` respectively
                inEmulation = true;
                break;
            default:
                // `0x000004` or larger are as-is
                break;
        }
    }
    if (inEmulation) {
        throw new Error("Invalid data");
    }
    yield buffer.subarray(start, buffer.length);
}
export class NaluSodbBitReader {
    get byteLength() {
        return __classPrivateFieldGet(this, _NaluSodbBitReader_byteLength, "f");
    }
    get stopBitIndex() {
        return __classPrivateFieldGet(this, _NaluSodbBitReader_stopBitIndex, "f");
    }
    get bytePosition() {
        return __classPrivateFieldGet(this, _NaluSodbBitReader_bytePosition, "f");
    }
    get bitPosition() {
        return __classPrivateFieldGet(this, _NaluSodbBitReader_bitPosition, "f");
    }
    get ended() {
        return (__classPrivateFieldGet(this, _NaluSodbBitReader_bytePosition, "f") >= __classPrivateFieldGet(this, _NaluSodbBitReader_byteLength, "f") &&
            __classPrivateFieldGet(this, _NaluSodbBitReader_bitPosition, "f") <= __classPrivateFieldGet(this, _NaluSodbBitReader_stopBitIndex, "f"));
    }
    constructor(nalu) {
        _NaluSodbBitReader_instances.add(this);
        _NaluSodbBitReader_nalu.set(this, void 0);
        // logical length is `#byteLength * 8 + (7 - #stopBitIndex)`
        _NaluSodbBitReader_byteLength.set(this, void 0);
        _NaluSodbBitReader_stopBitIndex.set(this, void 0);
        _NaluSodbBitReader_zeroCount.set(this, 0);
        // logical position is `#bytePosition * 8 + (7 - #bitPosition)`
        _NaluSodbBitReader_bytePosition.set(this, 0);
        _NaluSodbBitReader_bitPosition.set(this, 7);
        _NaluSodbBitReader_byte.set(this, 0);
        __classPrivateFieldSet(this, _NaluSodbBitReader_nalu, nalu, "f");
        // Search for the last bit being `1`, also known as the stop bit
        for (let i = nalu.length - 1; i >= 0; i -= 1) {
            if (__classPrivateFieldGet(this, _NaluSodbBitReader_nalu, "f")[i] === 0) {
                continue;
            }
            const byte = nalu[i];
            for (let j = 0; j < 8; j += 1) {
                if (((byte >> j) & 1) === 1) {
                    __classPrivateFieldSet(this, _NaluSodbBitReader_byteLength, i, "f");
                    __classPrivateFieldSet(this, _NaluSodbBitReader_stopBitIndex, j, "f");
                    __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_loadByte).call(this);
                    return;
                }
            }
        }
        throw new Error("Stop bit not found");
    }
    next() {
        if (this.ended) {
            throw new Error("Bit index out of bounds");
        }
        const value = (__classPrivateFieldGet(this, _NaluSodbBitReader_byte, "f") >> __classPrivateFieldGet(this, _NaluSodbBitReader_bitPosition, "f")) & 1;
        __classPrivateFieldSet(this, _NaluSodbBitReader_bitPosition, __classPrivateFieldGet(this, _NaluSodbBitReader_bitPosition, "f") - 1, "f");
        if (__classPrivateFieldGet(this, _NaluSodbBitReader_bitPosition, "f") < 0) {
            __classPrivateFieldSet(this, _NaluSodbBitReader_bytePosition, __classPrivateFieldGet(this, _NaluSodbBitReader_bytePosition, "f") + 1, "f");
            __classPrivateFieldSet(this, _NaluSodbBitReader_bitPosition, 7, "f");
            __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_loadByte).call(this);
        }
        return value;
    }
    read(length) {
        if (length > 32) {
            throw new Error("Read length too large");
        }
        let result = 0;
        for (let i = 0; i < length; i += 1) {
            result = (result << 1) | this.next();
        }
        return result;
    }
    skip(length) {
        if (length <= __classPrivateFieldGet(this, _NaluSodbBitReader_bitPosition, "f") + 1) {
            __classPrivateFieldSet(this, _NaluSodbBitReader_bitPosition, __classPrivateFieldGet(this, _NaluSodbBitReader_bitPosition, "f") - length, "f");
            __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_checkSkipPosition).call(this);
            return;
        }
        // Because of emulation prevention bytes,
        // we don't know how many bits are left in the NAL,
        // nor how many bits should be skipped.
        // So we need to check each byte.
        length -= __classPrivateFieldGet(this, _NaluSodbBitReader_bitPosition, "f") + 1;
        __classPrivateFieldSet(this, _NaluSodbBitReader_bytePosition, __classPrivateFieldGet(this, _NaluSodbBitReader_bytePosition, "f") + 1, "f");
        __classPrivateFieldSet(this, _NaluSodbBitReader_bitPosition, 7, "f");
        __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_loadByte).call(this);
        __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_checkSkipPosition).call(this);
        for (; length >= 8; length -= 8) {
            __classPrivateFieldSet(this, _NaluSodbBitReader_bytePosition, __classPrivateFieldGet(this, _NaluSodbBitReader_bytePosition, "f") + 1, "f");
            __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_loadByte).call(this);
            __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_checkSkipPosition).call(this);
        }
        __classPrivateFieldSet(this, _NaluSodbBitReader_bitPosition, 7 - length, "f");
        __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_checkSkipPosition).call(this);
    }
    decodeExponentialGolombNumber() {
        let length = 0;
        while (this.next() === 0) {
            length += 1;
        }
        if (length === 0) {
            return 0;
        }
        return ((1 << length) | this.read(length)) - 1;
    }
    peek(length) {
        const state = __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_save).call(this);
        const result = this.read(length);
        __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_restore).call(this, state);
        return result;
    }
    readBytes(length) {
        const result = new Uint8Array(length);
        for (let i = 0; i < length; i += 1) {
            result[i] = this.read(8);
        }
        return result;
    }
    peekBytes(length) {
        const state = __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_save).call(this);
        const result = this.readBytes(length);
        __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_restore).call(this, state);
        return result;
    }
}
_NaluSodbBitReader_nalu = new WeakMap(), _NaluSodbBitReader_byteLength = new WeakMap(), _NaluSodbBitReader_stopBitIndex = new WeakMap(), _NaluSodbBitReader_zeroCount = new WeakMap(), _NaluSodbBitReader_bytePosition = new WeakMap(), _NaluSodbBitReader_bitPosition = new WeakMap(), _NaluSodbBitReader_byte = new WeakMap(), _NaluSodbBitReader_instances = new WeakSet(), _NaluSodbBitReader_loadByte = function _NaluSodbBitReader_loadByte() {
    __classPrivateFieldSet(this, _NaluSodbBitReader_byte, __classPrivateFieldGet(this, _NaluSodbBitReader_nalu, "f")[__classPrivateFieldGet(this, _NaluSodbBitReader_bytePosition, "f")], "f");
    // If the current sequence is `0x000003`, skip to the next byte.
    // `annexBSplitNalu` had validated the input, so skip the check here
    if (__classPrivateFieldGet(this, _NaluSodbBitReader_zeroCount, "f") === 2 && __classPrivateFieldGet(this, _NaluSodbBitReader_byte, "f") === 3) {
        __classPrivateFieldSet(this, _NaluSodbBitReader_zeroCount, 0, "f");
        __classPrivateFieldSet(this, _NaluSodbBitReader_bytePosition, __classPrivateFieldGet(this, _NaluSodbBitReader_bytePosition, "f") + 1, "f");
        // Call `#loadByte` again, because if the next byte is `0x00`,
        // it need to be counted in `#zeroCount` as well.
        __classPrivateFieldGet(this, _NaluSodbBitReader_instances, "m", _NaluSodbBitReader_loadByte).call(this);
        return;
    }
    // `0x00000301` becomes `0x000001`, so only the `0x03` byte needs to be skipped
    // All `0x00` bytes are returned as-is
    if (__classPrivateFieldGet(this, _NaluSodbBitReader_byte, "f") === 0) {
        __classPrivateFieldSet(this, _NaluSodbBitReader_zeroCount, __classPrivateFieldGet(this, _NaluSodbBitReader_zeroCount, "f") + 1, "f");
    }
    else {
        __classPrivateFieldSet(this, _NaluSodbBitReader_zeroCount, 0, "f");
    }
}, _NaluSodbBitReader_checkSkipPosition = function _NaluSodbBitReader_checkSkipPosition() {
    if (__classPrivateFieldGet(this, _NaluSodbBitReader_bytePosition, "f") >= __classPrivateFieldGet(this, _NaluSodbBitReader_byteLength, "f") &&
        __classPrivateFieldGet(this, _NaluSodbBitReader_bitPosition, "f") < __classPrivateFieldGet(this, _NaluSodbBitReader_stopBitIndex, "f")) {
        throw new Error("Bit index out of bounds");
    }
}, _NaluSodbBitReader_save = function _NaluSodbBitReader_save() {
    return {
        zeroCount: __classPrivateFieldGet(this, _NaluSodbBitReader_zeroCount, "f"),
        bytePosition: __classPrivateFieldGet(this, _NaluSodbBitReader_bytePosition, "f"),
        bitPosition: __classPrivateFieldGet(this, _NaluSodbBitReader_bitPosition, "f"),
        byte: __classPrivateFieldGet(this, _NaluSodbBitReader_byte, "f"),
    };
}, _NaluSodbBitReader_restore = function _NaluSodbBitReader_restore(state) {
    __classPrivateFieldSet(this, _NaluSodbBitReader_zeroCount, state.zeroCount, "f");
    __classPrivateFieldSet(this, _NaluSodbBitReader_bytePosition, state.bytePosition, "f");
    __classPrivateFieldSet(this, _NaluSodbBitReader_bitPosition, state.bitPosition, "f");
    __classPrivateFieldSet(this, _NaluSodbBitReader_byte, state.byte, "f");
};
//# sourceMappingURL=nalu.js.map