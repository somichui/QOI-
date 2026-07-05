#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <vector>
#include <cstdint>
#include "qoi_core.h"
static std::vector<unsigned char> val_to_vec(const emscripten::val& arr) {
    unsigned int length = arr["length"].as<unsigned int>();
    std::vector<unsigned char> v(length);
    emscripten::val memoryView = emscripten::val::global("Uint8Array").new_(
        emscripten::val::module_property("HEAPU8")["buffer"],
        reinterpret_cast<uintptr_t>(v.data()),
        length
    );
    memoryView.call<void>("set", arr);
    return v;
}
static emscripten::val vec_to_val(const std::vector<unsigned char>& v) {
    emscripten::val view = emscripten::val(emscripten::typed_memory_view(v.size(), v.data()));
    emscripten::val result = emscripten::val::global("Uint8Array").new_(view);
    return result;
}
emscripten::val qoi_encode(emscripten::val pixels_val, int width, int height) {
    std::vector<unsigned char> pixels = val_to_vec(pixels_val);
    Image img(width, height, 4, std::move(pixels));
    QoiEncoder enc;
    std::vector<unsigned char> encoded = enc.encode(img);
    return vec_to_val(encoded);
}
emscripten::val qoiplus_encode(emscripten::val pixels_val, int width, int height) {
    std::vector<unsigned char> pixels = val_to_vec(pixels_val);
    Image img(width, height, 4, std::move(pixels));
    QoiPlusEncoder enc;
    std::vector<unsigned char> encoded = enc.encode(img);
    return vec_to_val(encoded);
}
emscripten::val qoi_decode(emscripten::val data_val) {
    std::vector<unsigned char> data = val_to_vec(data_val);
    QoiDecoder dec;
    Image img = dec.decode(data);
    emscripten::val result = emscripten::val::object();
    if (!img.isValid()) {
        result.set("pixels", emscripten::val::null());
        result.set("width", 0);
        result.set("height", 0);
        return result;
    }
    result.set("pixels", vec_to_val(img.getPixels()));
    result.set("width", img.getWidth());
    result.set("height", img.getHeight());
    return result;
}
emscripten::val qoiplus_decode(emscripten::val data_val) {
    std::vector<unsigned char> data = val_to_vec(data_val);
    QoiPlusDecoder dec;
    Image img = dec.decode(data);
    emscripten::val result = emscripten::val::object();
    if (!img.isValid()) {
        result.set("pixels", emscripten::val::null());
        result.set("width", 0);
        result.set("height", 0);
        return result;
    }
    result.set("pixels", vec_to_val(img.getPixels()));
    result.set("width", img.getWidth());
    result.set("height", img.getHeight());
    return result;
}
EMSCRIPTEN_BINDINGS(qoi_module) {
    emscripten::function("qoi_encode",    &qoi_encode);
    emscripten::function("qoi_decode",    &qoi_decode);
    emscripten::function("qoiplus_encode", &qoiplus_encode);
    emscripten::function("qoiplus_decode", &qoiplus_decode);
}