importScripts('qoi-engine.js?v=2');
self.onmessage = function(e) {
  const { type, id, pixels, width, height, encoded, huffman } = e.data;
  const startTime = performance.now();
  let resultObj = {};
  try {
    switch(type) {
      case 'encode_qoi':
        resultObj.encoded = new QoiEncoder().encode(pixels, width, height);
        break;
      case 'encode_qoiplus':
        resultObj.encoded = new QoiPlusEncoder().encode(pixels, width, height);
        break;
      case 'encode_qoiplus_huffman':
        let qoiPlusData = new QoiPlusEncoder().encode(pixels, width, height);
        resultObj.encoded = new HuffmanCoder().compress(qoiPlusData);
        break;
      case 'decode_qoi':
        Object.assign(resultObj, new QoiDecoder().decode(encoded));
        break;
      case 'decode_qoiplus':
        let decodeData = encoded;
        if (huffman) {
          decodeData = new HuffmanCoder().decompress(encoded);
        }
        Object.assign(resultObj, new QoiPlusDecoder().decode(decodeData));
        break;
      default:
        throw new Error("Unknown task type: " + type);
    }
    const timeMs = performance.now() - startTime;
    self.postMessage({
      type: type + '_result',
      id,
      timeMs,
      ...resultObj
    });
  } catch (err) {
    self.postMessage({
      type: type + '_error',
      id,
      error: err.toString()
    });
  }
};