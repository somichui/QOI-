class QoiEncoder {
    write32(out, pos, v) {
        out[pos++] = (v >> 24) & 0xFF;
        out[pos++] = (v >> 16) & 0xFF;
        out[pos++] = (v >> 8) & 0xFF;
        out[pos++] = v & 0xFF;
        return pos;
    }
    encode(pixels, width, height) {
        let max_size = width * height * 5 + 14 + 8;
        let out = new Uint8Array(max_size);
        let p = 0;
        out[p++] = 113; out[p++] = 111; out[p++] = 105; out[p++] = 102; 
        p = this.write32(out, p, width);
        p = this.write32(out, p, height);
        out[p++] = 4;
        out[p++] = 0;
        let index = new Uint8Array(64 * 4);
        let prevR = 0, prevG = 0, prevB = 0, prevA = 255;
        let run = 0;
        let num_pixels = width * height;
        for (let i = 0; i < num_pixels; i++) {
            let pxPos = i * 4;
            let curR = pixels[pxPos], curG = pixels[pxPos + 1], curB = pixels[pxPos + 2], curA = pixels[pxPos + 3];
            if (curR === prevR && curG === prevG && curB === prevB && curA === prevA) {
                run++;
                if (run === 62) {
                    out[p++] = 0xC0 | (run - 1);
                    run = 0;
                }
            } else {
                if (run > 0) {
                    out[p++] = 0xC0 | (run - 1);
                    run = 0;
                }
                let idxPos = ((curR * 3 + curG * 5 + curB * 7 + curA * 11) % 64) * 4;
                if (index[idxPos] === curR && index[idxPos + 1] === curG && index[idxPos + 2] === curB && index[idxPos + 3] === curA) {
                    out[p++] = (idxPos / 4) & 0x3F;
                } else {
                    index[idxPos] = curR;
                    index[idxPos + 1] = curG;
                    index[idxPos + 2] = curB;
                    index[idxPos + 3] = curA;
                    if (curA === prevA) {
                        let dr = (curR - prevR) & 0xFF; if (dr > 127) dr -= 256;
                        let dg = (curG - prevG) & 0xFF; if (dg > 127) dg -= 256;
                        let db = (curB - prevB) & 0xFF; if (db > 127) db -= 256;
                        if (dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
                            out[p++] = 0x40 | (((dr + 2) & 0x03) << 4) | (((dg + 2) & 0x03) << 2) | ((db + 2) & 0x03);
                        } else {
                            let dr_dg = dr - dg;
                            let db_dg = db - dg;
                            if (dg >= -32 && dg <= 31 && dr_dg >= -8 && dr_dg <= 7 && db_dg >= -8 && db_dg <= 7) {
                                out[p++] = 0x80 | ((dg + 32) & 0x3F);
                                out[p++] = (((dr_dg + 8) & 0x0F) << 4) | ((db_dg + 8) & 0x0F);
                            } else {
                                out[p++] = 0xFE; out[p++] = curR; out[p++] = curG; out[p++] = curB;
                            }
                        }
                    } else {
                        out[p++] = 0xFF; out[p++] = curR; out[p++] = curG; out[p++] = curB; out[p++] = curA;
                    }
                }
            }
            prevR = curR; prevG = curG; prevB = curB; prevA = curA;
        }
        if (run > 0) {
            out[p++] = 0xC0 | (run - 1);
        }
        for (let i = 0; i < 7; i++) out[p++] = 0;
        out[p++] = 1;
        return out.slice(0, p);
    }
}
class QoiDecoder {
    read32(data, pos) {
        return ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>> 0;
    }
    decode(data) {
        let p = 0;
        if (data[p++] !== 113 || data[p++] !== 111 || data[p++] !== 105 || data[p++] !== 102) return null; 
        let width = this.read32(data, p); p += 4;
        let height = this.read32(data, p); p += 4;
        let channels = data[p++];
        let colorspace = data[p++];
        let pixels = new Uint8Array(width * height * 4);
        let index = new Uint8Array(64 * 4);
        let pxR = 0, pxG = 0, pxB = 0, pxA = 255;
        let num_pixels = width * height;
        let data_end = data.length - 8;
        let out_pos = 0;
        while (out_pos < pixels.length && p < data_end) {
            let b1 = data[p++];
            if (b1 === 0xFE) {
                pxR = data[p++]; pxG = data[p++]; pxB = data[p++];
            } else if (b1 === 0xFF) {
                pxR = data[p++]; pxG = data[p++]; pxB = data[p++]; pxA = data[p++];
            } else {
                let tag = b1 & 0xC0;
                if (tag === 0x00) {
                    let idx = (b1 & 0x3F) * 4;
                    pxR = index[idx]; pxG = index[idx + 1]; pxB = index[idx + 2]; pxA = index[idx + 3];
                } else if (tag === 0x40) {
                    pxR = (pxR + (((b1 >> 4) & 0x03) - 2)) & 0xFF;
                    pxG = (pxG + (((b1 >> 2) & 0x03) - 2)) & 0xFF;
                    pxB = (pxB + ((b1 & 0x03) - 2)) & 0xFF;
                } else if (tag === 0x80) {
                    let b2 = data[p++];
                    let dg = (b1 & 0x3F) - 32;
                    pxR = (pxR + dg + (((b2 >> 4) & 0x0F) - 8)) & 0xFF;
                    pxG = (pxG + dg) & 0xFF;
                    pxB = (pxB + dg + ((b2 & 0x0F) - 8)) & 0xFF;
                } else if (tag === 0xC0) {
                    let run = (b1 & 0x3F) + 1;
                    for (let k = 0; k < run; k++) {
                        pixels[out_pos++] = pxR; pixels[out_pos++] = pxG; pixels[out_pos++] = pxB; pixels[out_pos++] = pxA;
                    }
                    let idx = ((pxR * 3 + pxG * 5 + pxB * 7 + pxA * 11) % 64) * 4;
                    index[idx] = pxR; index[idx + 1] = pxG; index[idx + 2] = pxB; index[idx + 3] = pxA;
                    continue; 
                }
            }
            pixels[out_pos++] = pxR; pixels[out_pos++] = pxG; pixels[out_pos++] = pxB; pixels[out_pos++] = pxA;
            let idx = ((pxR * 3 + pxG * 5 + pxB * 7 + pxA * 11) % 64) * 4;
            index[idx] = pxR; index[idx + 1] = pxG; index[idx + 2] = pxB; index[idx + 3] = pxA;
        }
        return { pixels, width, height };
    }
}
function paethPredict(leftR, leftG, leftB, leftA, aboveR, aboveG, aboveB, aboveA, ulR, ulG, ulB, ulA) {
    function paethChannel(a, b, c) {
        let p = a + b - c;
        let pa = Math.abs(p - a);
        let pb = Math.abs(p - b);
        let pc = Math.abs(p - c);
        if (pa <= pb && pa <= pc) return a;
        if (pb <= pc) return b;
        return c;
    }
    return [
        paethChannel(leftR, aboveR, ulR),
        paethChannel(leftG, aboveG, ulG),
        paethChannel(leftB, aboveB, ulB),
        paethChannel(leftA, aboveA, ulA)
    ];
}
class QoiPlusEncoder {
    write32(out, pos, v) {
        out[pos++] = (v >> 24) & 0xFF;
        out[pos++] = (v >> 16) & 0xFF;
        out[pos++] = (v >> 8) & 0xFF;
        out[pos++] = v & 0xFF;
        return pos;
    }
    encode(pixels, width, height) {
        let max_size = width * height * 5 + 14 + 8;
        let out = new Uint8Array(max_size);
        let p = 0;
        out[p++] = 0x71; out[p++] = 0x6F; out[p++] = 0x69; out[p++] = 0x2B; 
        p = this.write32(out, p, width);
        p = this.write32(out, p, height);
        out[p++] = 4;
        out[p++] = 0;
        let index = new Uint8Array(256 * 4);
        let row_buffer = new Uint8Array(width * 4);
        for(let i = 0; i < width*4; i+=4) {
            row_buffer[i] = 0; row_buffer[i+1] = 0; row_buffer[i+2] = 0; row_buffer[i+3] = 255;
        }
        let prevR = 0, prevG = 0, prevB = 0, prevA = 255;
        let run = 0;
        for (let y = 0; y < height; y++) {
            let ulR = 0, ulG = 0, ulB = 0, ulA = 255;
            for (let x = 0; x < width; x++) {
                let pxPos = (y * width + x) * 4;
                let curR = pixels[pxPos], curG = pixels[pxPos + 1], curB = pixels[pxPos + 2], curA = pixels[pxPos + 3];
                let aboveR = row_buffer[x*4], aboveG = row_buffer[x*4+1], aboveB = row_buffer[x*4+2], aboveA = row_buffer[x*4+3];
                let predR, predG, predB, predA;
                if (y === 0 && x === 0) { predR = 0; predG = 0; predB = 0; predA = 255; }
                else if (y === 0) { predR = prevR; predG = prevG; predB = prevB; predA = prevA; }
                else if (x === 0) { predR = aboveR; predG = aboveG; predB = aboveB; predA = aboveA; }
                else {
                    let pred = paethPredict(prevR, prevG, prevB, prevA, aboveR, aboveG, aboveB, aboveA, ulR, ulG, ulB, ulA);
                    predR = pred[0]; predG = pred[1]; predB = pred[2]; predA = pred[3];
                }
                if (curR === prevR && curG === prevG && curB === prevB && curA === prevA) {
                    run++;
                    if (run === 60) {
                        out[p++] = 0xC0 | (run - 1);
                        run = 0;
                    }
                } else {
                    if (run > 0) {
                        out[p++] = 0xC0 | (run - 1);
                        run = 0;
                    }
                    let hash = (curR * 3 + curG * 5 + curB * 7 + curA * 11) % 256;
                    let idxPos = hash * 4;
                    if (index[idxPos] === curR && index[idxPos + 1] === curG && index[idxPos + 2] === curB && index[idxPos + 3] === curA) {
                        if (hash < 64) {
                            out[p++] = hash;
                        } else {
                            out[p++] = 0xFC;
                            out[p++] = hash;
                        }
                    } else {
                        index[idxPos] = curR; index[idxPos + 1] = curG; index[idxPos + 2] = curB; index[idxPos + 3] = curA;
                        if (curA === predA) {
                            let dr = (curR - predR) & 0xFF; if (dr > 127) dr -= 256;
                            let dg = (curG - predG) & 0xFF; if (dg > 127) dg -= 256;
                            let db = (curB - predB) & 0xFF; if (db > 127) db -= 256;
                            if (dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
                                out[p++] = 0x40 | (((dr + 2) & 0x03) << 4) | (((dg + 2) & 0x03) << 2) | ((db + 2) & 0x03);
                            } else {
                                let dr_dg = dr - dg;
                                let db_dg = db - dg;
                                if (dg >= -32 && dg <= 31 && dr_dg >= -8 && dr_dg <= 7 && db_dg >= -8 && db_dg <= 7) {
                                    out[p++] = 0x80 | ((dg + 32) & 0x3F);
                                    out[p++] = (((dr_dg + 8) & 0x0F) << 4) | ((db_dg + 8) & 0x0F);
                                } else {
                                    out[p++] = 0xFE; out[p++] = curR; out[p++] = curG; out[p++] = curB;
                                }
                            }
                        } else {
                            out[p++] = 0xFF; out[p++] = curR; out[p++] = curG; out[p++] = curB; out[p++] = curA;
                        }
                    }
                }
                ulR = aboveR; ulG = aboveG; ulB = aboveB; ulA = aboveA;
                row_buffer[x*4] = curR; row_buffer[x*4+1] = curG; row_buffer[x*4+2] = curB; row_buffer[x*4+3] = curA;
                prevR = curR; prevG = curG; prevB = curB; prevA = curA;
            }
        }
        if (run > 0) {
            out[p++] = 0xC0 | (run - 1);
        }
        for (let i = 0; i < 7; i++) out[p++] = 0;
        out[p++] = 1;
        return out.slice(0, p);
    }
}
class QoiPlusDecoder {
    read32(data, pos) {
        return ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>> 0;
    }
    decode(data) {
        let p = 0;
        if (data[p++] !== 0x71 || data[p++] !== 0x6F || data[p++] !== 0x69 || data[p++] !== 0x2B) return null; 
        let width = this.read32(data, p); p += 4;
        let height = this.read32(data, p); p += 4;
        let channels = data[p++];
        let colorspace = data[p++];
        let pixels = new Uint8Array(width * height * 4);
        let index = new Uint8Array(256 * 4);
        let row_buffer = new Uint8Array(width * 4);
        for(let i = 0; i < width*4; i+=4) {
            row_buffer[i] = 0; row_buffer[i+1] = 0; row_buffer[i+2] = 0; row_buffer[i+3] = 255;
        }
        let prevR = 0, prevG = 0, prevB = 0, prevA = 255;
        let data_end = data.length - 8;
        let pxR = 0, pxG = 0, pxB = 0, pxA = 255;
        for (let y = 0; y < height; y++) {
            let ulR = 0, ulG = 0, ulB = 0, ulA = 255;
            for (let x = 0; x < width; x++) {
                if (p >= data_end) break;
                let aboveR = row_buffer[x*4], aboveG = row_buffer[x*4+1], aboveB = row_buffer[x*4+2], aboveA = row_buffer[x*4+3];
                let predR, predG, predB, predA;
                if (y === 0 && x === 0) { predR = 0; predG = 0; predB = 0; predA = 255; }
                else if (y === 0) { predR = prevR; predG = prevG; predB = prevB; predA = prevA; }
                else if (x === 0) { predR = aboveR; predG = aboveG; predB = aboveB; predA = aboveA; }
                else {
                    let pred = paethPredict(prevR, prevG, prevB, prevA, aboveR, aboveG, aboveB, aboveA, ulR, ulG, ulB, ulA);
                    predR = pred[0]; predG = pred[1]; predB = pred[2]; predA = pred[3];
                }
            }
        }
        let out_pos = 0;
        let x = 0, y = 0;
        let ulR = 0, ulG = 0, ulB = 0, ulA = 255;
        while (out_pos < pixels.length && p < data_end) {
            let aboveR = row_buffer[x*4], aboveG = row_buffer[x*4+1], aboveB = row_buffer[x*4+2], aboveA = row_buffer[x*4+3];
            let predR, predG, predB, predA;
            if (y === 0 && x === 0) { predR = 0; predG = 0; predB = 0; predA = 255; }
            else if (y === 0) { predR = prevR; predG = prevG; predB = prevB; predA = prevA; }
            else if (x === 0) { predR = aboveR; predG = aboveG; predB = aboveB; predA = aboveA; }
            else {
                let pred = paethPredict(prevR, prevG, prevB, prevA, aboveR, aboveG, aboveB, aboveA, ulR, ulG, ulB, ulA);
                predR = pred[0]; predG = pred[1]; predB = pred[2]; predA = pred[3];
            }
            let b1 = data[p++];
            if (b1 === 0xFE) {
                pxR = data[p++]; pxG = data[p++]; pxB = data[p++]; pxA = predA;
            } else if (b1 === 0xFF) {
                pxR = data[p++]; pxG = data[p++]; pxB = data[p++]; pxA = data[p++];
            } else if (b1 === 0xFC) {
                let hash = data[p++];
                let idx = hash * 4;
                pxR = index[idx]; pxG = index[idx + 1]; pxB = index[idx + 2]; pxA = index[idx + 3];
            } else if (b1 === 0xFD) {
            } else if (b1 >= 0xC0 && b1 <= 0xFB) {
                let run = (b1 - 0xC0) + 1;
                for (let k = 0; k < run; k++) {
                    pixels[out_pos++] = prevR; pixels[out_pos++] = prevG; pixels[out_pos++] = prevB; pixels[out_pos++] = prevA;
                    let curr_aboveR = row_buffer[x*4], curr_aboveG = row_buffer[x*4+1], curr_aboveB = row_buffer[x*4+2], curr_aboveA = row_buffer[x*4+3];
                    ulR = curr_aboveR; ulG = curr_aboveG; ulB = curr_aboveB; ulA = curr_aboveA;
                    row_buffer[x*4] = prevR; row_buffer[x*4+1] = prevG; row_buffer[x*4+2] = prevB; row_buffer[x*4+3] = prevA;
                    x++;
                    if (x === width) { x = 0; y++; ulR = 0; ulG = 0; ulB = 0; ulA = 255; }
                }
                continue; 
            } else {
                let tag = b1 & 0xC0;
                if (tag === 0x00) {
                    let hash = b1 & 0x3F;
                    let idx = hash * 4;
                    pxR = index[idx]; pxG = index[idx + 1]; pxB = index[idx + 2]; pxA = index[idx + 3];
                } else if (tag === 0x40) {
                    pxR = (predR + (((b1 >> 4) & 0x03) - 2)) & 0xFF;
                    pxG = (predG + (((b1 >> 2) & 0x03) - 2)) & 0xFF;
                    pxB = (predB + ((b1 & 0x03) - 2)) & 0xFF;
                    pxA = predA;
                } else if (tag === 0x80) {
                    let b2 = data[p++];
                    let dg = (b1 & 0x3F) - 32;
                    pxR = (predR + dg + (((b2 >> 4) & 0x0F) - 8)) & 0xFF;
                    pxG = (predG + dg) & 0xFF;
                    pxB = (predB + dg + ((b2 & 0x0F) - 8)) & 0xFF;
                    pxA = predA;
                }
            }
            pixels[out_pos++] = pxR; pixels[out_pos++] = pxG; pixels[out_pos++] = pxB; pixels[out_pos++] = pxA;
            let hash = ((pxR * 3 + pxG * 5 + pxB * 7 + pxA * 11) % 256) * 4;
            index[hash] = pxR; index[hash + 1] = pxG; index[hash + 2] = pxB; index[hash + 3] = pxA;
            ulR = aboveR; ulG = aboveG; ulB = aboveB; ulA = aboveA;
            row_buffer[x*4] = pxR; row_buffer[x*4+1] = pxG; row_buffer[x*4+2] = pxB; row_buffer[x*4+3] = pxA;
            prevR = pxR; prevG = pxG; prevB = pxB; prevA = pxA;
            x++;
            if (x === width) { x = 0; y++; ulR = 0; ulG = 0; ulB = 0; ulA = 255; }
        }
        return { pixels, width, height };
    }
}
class HuffmanNode {
    constructor(sym, freq) {
        this.sym = sym;
        this.freq = freq;
        this.left = null;
        this.right = null;
    }
}
class HuffmanCoder {
    compress(data) {
        let freqs = new Int32Array(256);
        for (let i = 0; i < data.length; i++) freqs[data[i]]++;
        let nodes = [];
        for (let i = 0; i < 256; i++) {
            if (freqs[i] > 0) nodes.push(new HuffmanNode(i, freqs[i]));
        }
        if (nodes.length === 0) return new Uint8Array(4 + 256);
        if (nodes.length === 1) nodes.push(new HuffmanNode(nodes[0].sym === 0 ? 1 : 0, 0));
        while (nodes.length > 1) {
            nodes.sort((a, b) => a.freq - b.freq);
            let n1 = nodes.shift();
            let n2 = nodes.shift();
            let parent = new HuffmanNode(-1, n1.freq + n2.freq);
            parent.left = n1;
            parent.right = n2;
            nodes.push(parent);
        }
        let root = nodes[0];
        let lengths = new Uint8Array(256);
        function getLengths(node, depth) {
            if (node.sym !== -1) {
                lengths[node.sym] = depth;
            } else {
                getLengths(node.left, depth + 1);
                getLengths(node.right, depth + 1);
            }
        }
        getLengths(root, 0);
        let codes = new Array(256);
        let max_len = 0;
        for (let i = 0; i < 256; i++) {
            if (lengths[i] > max_len) max_len = lengths[i];
        }
        let bl_count = new Int32Array(max_len + 1);
        for (let i = 0; i < 256; i++) bl_count[lengths[i]]++;
        let next_code = new Int32Array(max_len + 1);
        let code = 0;
        bl_count[0] = 0;
        for (let bits = 1; bits <= max_len; bits++) {
            code = (code + bl_count[bits - 1]) << 1;
            next_code[bits] = code;
        }
        for (let i = 0; i < 256; i++) {
            let len = lengths[i];
            if (len !== 0) {
                codes[i] = { code: next_code[len], len: len };
                next_code[len]++;
            }
        }
        let out_cap = 4 + 256 + Math.ceil(data.length * 1.1) + 16; 
        let out = new Uint8Array(out_cap);
        let p = 0;
        out[p++] = (data.length >> 24) & 0xFF;
        out[p++] = (data.length >> 16) & 0xFF;
        out[p++] = (data.length >> 8) & 0xFF;
        out[p++] = data.length & 0xFF;
        for (let i = 0; i < 256; i++) out[p++] = lengths[i];
        let bitBuffer = 0;
        let bitCount = 0;
        for (let i = 0; i < data.length; i++) {
            let sym = data[i];
            let c = codes[sym];
            bitBuffer = (bitBuffer << c.len) | c.code;
            bitCount += c.len;
            while (bitCount >= 8) {
                if (p >= out.length) {
                    let new_out = new Uint8Array(out.length * 2);
                    new_out.set(out);
                    out = new_out;
                }
                out[p++] = (bitBuffer >> (bitCount - 8)) & 0xFF;
                bitCount -= 8;
            }
        }
        if (bitCount > 0) {
            out[p++] = (bitBuffer << (8 - bitCount)) & 0xFF;
        }
        return out.slice(0, p);
    }
    decompress(data) {
        if (data.length < 260) return new Uint8Array(0);
        let p = 0;
        let orig_len = ((data[p] << 24) | (data[p+1] << 16) | (data[p+2] << 8) | data[p+3]) >>> 0;
        p += 4;
        let lengths = new Uint8Array(256);
        let max_len = 0;
        for (let i = 0; i < 256; i++) {
            lengths[i] = data[p++];
            if (lengths[i] > max_len) max_len = lengths[i];
        }
        let bl_count = new Int32Array(max_len + 1);
        for (let i = 0; i < 256; i++) bl_count[lengths[i]]++;
        bl_count[0] = 0;
        let next_code = new Int32Array(max_len + 1);
        let code = 0;
        for (let bits = 1; bits <= max_len; bits++) {
            code = (code + bl_count[bits - 1]) << 1;
            next_code[bits] = code;
        }
        let root = {};
        for (let i = 0; i < 256; i++) {
            let len = lengths[i];
            if (len > 0) {
                let c = next_code[len];
                next_code[len]++;
                let node = root;
                for (let b = len - 1; b >= 0; b--) {
                    let bit = (c >> b) & 1;
                    if (bit === 0) {
                        if (!node.left) node.left = {};
                        node = node.left;
                    } else {
                        if (!node.right) node.right = {};
                        node = node.right;
                    }
                }
                node.sym = i;
            }
        }
        let out = new Uint8Array(orig_len);
        let out_p = 0;
        let bitBuffer = 0;
        let bitCount = 0;
        let node = root;
        while (out_p < orig_len && (p < data.length || bitCount > 0)) {
            if (bitCount === 0) {
                if (p < data.length) {
                    bitBuffer = data[p++];
                    bitCount = 8;
                } else break;
            }
            let bit = (bitBuffer >> (bitCount - 1)) & 1;
            bitCount--;
            node = bit === 0 ? node.left : node.right;
            if (node.sym !== undefined) {
                out[out_p++] = node.sym;
                node = root;
            }
        }
        return out;
    }
}
if (typeof self !== 'undefined') {
    self.QoiEncoder = QoiEncoder;
    self.QoiDecoder = QoiDecoder;
    self.QoiPlusEncoder = QoiPlusEncoder;
    self.QoiPlusDecoder = QoiPlusDecoder;
    self.HuffmanCoder = HuffmanCoder;
}