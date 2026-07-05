#pragma once
#include <iostream>
#include <string>
#include <vector>
#include <fstream>
#include <cstdint>
#include <algorithm>
#include <cmath>
namespace fs {
    inline std::string getExtension(const std::string& filepath) {
        size_t dot_pos = filepath.find_last_of('.');
        if (dot_pos == std::string::npos) return "";
        std::string ext = filepath.substr(dot_pos);
        std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c){ return std::tolower(c); });
        return ext;
    }
    inline std::string changeExtension(const std::string& filepath, const std::string& new_ext) {
        size_t dot_pos = filepath.find_last_of('.');
        if (dot_pos == std::string::npos) return filepath + new_ext;
        return filepath.substr(0, dot_pos) + new_ext;
    }
}
struct Rgba {
    uint8_t r, g, b, a;
    bool operator==(const Rgba& other) const {
        return r==other.r && g==other.g && b==other.b && a==other.a;
    }
    bool operator!=(const Rgba& other) const {
        return !(*this == other);
    }
};
class Image {
private:
    int width{0}, height{0}, channels{0};
    std::vector<unsigned char> pixels;
public:
    Image(int w, int h, int c, std::vector<unsigned char>&& p)
        : width(w), height(h), channels(c), pixels(std::move(p)) {}
    int getWidth() const { return width; }
    int getHeight() const { return height; }
    int getChannels() const { return channels; }
    const std::vector<unsigned char>& getPixels() const { return pixels; }
    const unsigned char* getPixelsPtr() const { return pixels.empty() ? nullptr : pixels.data(); }
    bool isValid() const { return width > 0 && height > 0 && !pixels.empty(); }
};
class QoiEncoder {
private:
    void write_32_be(std::vector<unsigned char>& out, uint32_t v) {
        out.push_back((v >> 24) & 0xFF);
        out.push_back((v >> 16) & 0xFF);
        out.push_back((v >> 8)  & 0xFF);
        out.push_back(v & 0xFF);
    }
public:
    std::vector<unsigned char> encode(const Image& image) {
        std::vector<unsigned char> out;
        out.push_back('q'); out.push_back('o'); out.push_back('i'); out.push_back('f');
        write_32_be(out, static_cast<uint32_t>(image.getWidth()));
        write_32_be(out, static_cast<uint32_t>(image.getHeight()));
        out.push_back(static_cast<unsigned char>(image.getChannels()));
        out.push_back(0);
        const auto &pix = image.getPixels();
        int num_pixels = image.getWidth() * image.getHeight();
        Rgba prev = {0,0,0,255};
        int run = 0;
        Rgba index[64] = {};
        auto index_pos = [&](const Rgba &p)->int {
            return (p.r * 3 + p.g * 5 + p.b * 7 + p.a * 11) % 64;
        };
        for (int i = 0; i < num_pixels; ++i) {
            Rgba cur;
            cur.r = pix[i*4 + 0];
            cur.g = pix[i*4 + 1];
            cur.b = pix[i*4 + 2];
            cur.a = pix[i*4 + 3];
            if (cur == prev) {
                run++;
                if (run == 62) {
                    out.push_back(0xC0 | (run - 1));
                    run = 0;
                }
            } else {
                if (run > 0) {
                    out.push_back(0xC0 | (run - 1));
                    run = 0;
                }
                int idx = index_pos(cur);
                if (index[idx] == cur) {
                    out.push_back(static_cast<unsigned char>(idx & 0x3F));
                } else {
                    index[idx] = cur;
                    if (cur.a == prev.a) {
                        int dr = (int)cur.r - (int)prev.r;
                        int dg = (int)cur.g - (int)prev.g;
                        int db = (int)cur.b - (int)prev.b;
                        if (dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
                            unsigned char packed = 0x40
                                | (static_cast<unsigned char>((dr + 2) & 0x03) << 4)
                                | (static_cast<unsigned char>((dg + 2) & 0x03) << 2)
                                | (static_cast<unsigned char>((db + 2) & 0x03));
                            out.push_back(packed);
                        }
                        else {
                            int dg_val = dg;
                            int dr_dg = dr - dg;
                            int db_dg = db - dg;
                            if (dg_val >= -32 && dg_val <= 31 && dr_dg >= -8 && dr_dg <= 7 && db_dg >= -8 && db_dg <= 7) {
                                unsigned char b1 = 0x80 | static_cast<unsigned char>((dg_val + 32) & 0x3F);
                                unsigned char b2 = static_cast<unsigned char>(((dr_dg + 8) & 0x0F) << 4 | ((db_dg + 8) & 0x0F));
                                out.push_back(b1);
                                out.push_back(b2);
                            } else {
                                out.push_back(0xFE);
                                out.push_back(cur.r);
                                out.push_back(cur.g);
                                out.push_back(cur.b);
                            }
                        }
                    } else {
                        out.push_back(0xFF);
                        out.push_back(cur.r);
                        out.push_back(cur.g);
                        out.push_back(cur.b);
                        out.push_back(cur.a);
                    }
                }
            }
            prev = cur;
        }
        if (run > 0) out.push_back(0xC0 | (run - 1));
        const unsigned char end_marker[8] = {0,0,0,0,0,0,0,1};
        out.insert(out.end(), end_marker, end_marker + 8);
        return out;
    }
};
class QoiDecoder {
private:
    static uint32_t read_u32_be(const std::vector<unsigned char>& data, size_t& idx) {
        uint32_t v = (static_cast<uint32_t>(data[idx]) << 24) |
                     (static_cast<uint32_t>(data[idx+1]) << 16) |
                     (static_cast<uint32_t>(data[idx+2]) << 8) |
                     (static_cast<uint32_t>(data[idx+3]));
        idx += 4;
        return v;
    }
public:
    Image decode(const std::vector<unsigned char>& qoi_data) {
        size_t p = 0;
        if (qoi_data[p] != 'q' || qoi_data[p+1] != 'o' || qoi_data[p+2] != 'i' || qoi_data[p+3] != 'f')
            return Image(0,0,0,{});
        p += 4;
        uint32_t width = read_u32_be(qoi_data, p);
        uint32_t height = read_u32_be(qoi_data, p);
        unsigned char channels = qoi_data[p++];
        unsigned char colorspace = qoi_data[p++];
        (void)colorspace;
        size_t num_pixels = static_cast<size_t>(width) * static_cast<size_t>(height);
        std::vector<unsigned char> out;
        out.reserve(num_pixels * 4);
        Rgba index[64] = {};
        Rgba px = {0, 0, 0, 255};
        const size_t data_end = (qoi_data.size() >= 8) ? qoi_data.size() - 8 : 0;
        auto push_pixel = [&](const Rgba &pcol) {
            out.push_back(pcol.r);
            out.push_back(pcol.g);
            out.push_back(pcol.b);
            out.push_back(pcol.a);
            int idxpos = (pcol.r * 3 + pcol.g * 5 + pcol.b * 7 + pcol.a * 11) % 64;
            index[idxpos] = pcol;
        };
        while (out.size() < num_pixels * 4 && p < data_end) {
            unsigned char b1 = qoi_data[p++];
            if (b1 == 0xFE) {
                px.r = qoi_data[p++];
                px.g = qoi_data[p++];
                px.b = qoi_data[p++];
                push_pixel(px);
            }
            else if (b1 == 0xFF) {
                px.r = qoi_data[p++];
                px.g = qoi_data[p++];
                px.b = qoi_data[p++];
                px.a = qoi_data[p++];
                push_pixel(px);
            }
            else {
                unsigned char tag = b1 & 0xC0;
                if (tag == 0x00) {
                    unsigned char idx = b1 & 0x3F;
                    px = index[idx];
                    push_pixel(px);
                }
                else if (tag == 0x40) {
                    int dr = ((b1 >> 4) & 0x03) - 2;
                    int dg = ((b1 >> 2) & 0x03) - 2;
                    int db = (b1 & 0x03) - 2;
                    px.r = static_cast<uint8_t>(static_cast<int>(px.r) + dr);
                    px.g = static_cast<uint8_t>(static_cast<int>(px.g) + dg);
                    px.b = static_cast<uint8_t>(static_cast<int>(px.b) + db);
                    push_pixel(px);
                }
                else if (tag == 0x80) {
                    unsigned char b2 = qoi_data[p++];
                    int dg = (b1 & 0x3F) - 32;
                    int dr_dg = ((b2 >> 4) & 0x0F) - 8;
                    int db_dg = (b2 & 0x0F) - 8;
                    px.r = static_cast<uint8_t>(static_cast<int>(px.r) + dg + dr_dg);
                    px.g = static_cast<uint8_t>(static_cast<int>(px.g) + dg);
                    px.b = static_cast<uint8_t>(static_cast<int>(px.b) + dg + db_dg);
                    push_pixel(px);
                }
                else if (tag == 0xC0) {
                    int run = (b1 & 0x3F) + 1;
                    for (int k = 0; k < run; ++k) {
                        out.push_back(px.r);
                        out.push_back(px.g);
                        out.push_back(px.b);
                        out.push_back(px.a);
                    }
                    int idxpos = (px.r * 3 + px.g * 5 + px.b * 7 + px.a * 11) % 64;
                    index[idxpos] = px;
                }
                else break;
            }
        }
        return Image(static_cast<int>(width), static_cast<int>(height), 4, std::move(out));
    }
};
inline void write_file(const std::string& path, const std::vector<unsigned char>& data) {
    std::ofstream f(path, std::ios::binary);
    if (!f) return;
    f.write(reinterpret_cast<const char*>(data.data()), data.size());
    f.close();
}
inline std::vector<unsigned char> read_file(const std::string& path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return {};
    std::streamsize sz = f.tellg();
    if (sz <= 0) return {};
    f.seekg(0, std::ios::beg);
    std::vector<unsigned char> buf(static_cast<size_t>(sz));
    if (!f.read(reinterpret_cast<char*>(buf.data()), sz)) return {};
    f.close();
    return buf;
}
namespace qoiplus_detail {
    inline Rgba paeth_predict(const Rgba& left, const Rgba& above, const Rgba& upper_left) {
        auto paeth_channel = [](int a, int b, int c) -> uint8_t {
            int p = a + b - c;
            int pa = std::abs(p - a);
            int pb = std::abs(p - b);
            int pc = std::abs(p - c);
            if (pa <= pb && pa <= pc) return static_cast<uint8_t>(a);
            if (pb <= pc) return static_cast<uint8_t>(b);
            return static_cast<uint8_t>(c);
        };
        return {
            paeth_channel(left.r, above.r, upper_left.r),
            paeth_channel(left.g, above.g, upper_left.g),
            paeth_channel(left.b, above.b, upper_left.b),
            paeth_channel(left.a, above.a, upper_left.a)
        };
    }
    inline int hash_256(const Rgba& p) {
        return (p.r * 3 + p.g * 5 + p.b * 7 + p.a * 11) % 256;
    }
} 
class QoiPlusEncoder {
private:
    void write_32_be(std::vector<unsigned char>& out, uint32_t v) {
        out.push_back((v >> 24) & 0xFF);
        out.push_back((v >> 16) & 0xFF);
        out.push_back((v >> 8)  & 0xFF);
        out.push_back(v & 0xFF);
    }
public:
    std::vector<unsigned char> encode(const Image& image) {
        using namespace qoiplus_detail;
        const int width  = image.getWidth();
        const int height = image.getHeight();
        const auto& pix  = image.getPixels();
        std::vector<unsigned char> out;
        out.reserve(pix.size()); 
        out.push_back(0x71); out.push_back(0x6F);
        out.push_back(0x69); out.push_back(0x2B);
        write_32_be(out, static_cast<uint32_t>(width));
        write_32_be(out, static_cast<uint32_t>(height));
        out.push_back(static_cast<unsigned char>(image.getChannels()));
        out.push_back(0); 
        Rgba index[256] = {};
        Rgba prev = {0, 0, 0, 255};     
        int run = 0;
        std::vector<Rgba> row_buffer(width, {0, 0, 0, 255});
        for (int y = 0; y < height; ++y) {
            Rgba upper_left_saved = {0, 0, 0, 255};
            for (int x = 0; x < width; ++x) {
                int i = y * width + x;
                Rgba cur;
                cur.r = pix[i * 4 + 0];
                cur.g = pix[i * 4 + 1];
                cur.b = pix[i * 4 + 2];
                cur.a = pix[i * 4 + 3];
                Rgba above = row_buffer[x];
                Rgba predicted;
                if (y == 0 && x == 0)      predicted = {0, 0, 0, 255};
                else if (y == 0)            predicted = prev;
                else if (x == 0)            predicted = above;
                else                        predicted = paeth_predict(prev, above, upper_left_saved);
                if (cur == prev) {
                    run++;
                    if (run == 60) {
                        out.push_back(static_cast<unsigned char>(0xC0 + (run - 1)));
                        run = 0;
                    }
                } else {
                    if (run > 0) {
                        out.push_back(static_cast<unsigned char>(0xC0 + (run - 1)));
                        run = 0;
                    }
                    int h = hash_256(cur);
                    if (index[h] == cur) {
                        if (h < 64) {
                            out.push_back(static_cast<unsigned char>(h & 0x3F));
                        } else {
                            out.push_back(0xFC);
                            out.push_back(static_cast<unsigned char>(h));
                        }
                    } else {
                        index[h] = cur;
                        if (cur.a == predicted.a) {
                            int dr = (int)cur.r - (int)predicted.r;
                            int dg = (int)cur.g - (int)predicted.g;
                            int db = (int)cur.b - (int)predicted.b;
                            if (dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
                                unsigned char packed = 0x40
                                    | (static_cast<unsigned char>((dr + 2) & 0x03) << 4)
                                    | (static_cast<unsigned char>((dg + 2) & 0x03) << 2)
                                    | (static_cast<unsigned char>((db + 2) & 0x03));
                                out.push_back(packed);
                            }
                            else {
                                int dg_val = dg;
                                int dr_dg = dr - dg;
                                int db_dg = db - dg;
                                if (dg_val >= -32 && dg_val <= 31 &&
                                    dr_dg >= -8 && dr_dg <= 7 &&
                                    db_dg >= -8 && db_dg <= 7) {
                                    unsigned char b1 = 0x80 | static_cast<unsigned char>((dg_val + 32) & 0x3F);
                                    unsigned char b2 = static_cast<unsigned char>(
                                        ((dr_dg + 8) & 0x0F) << 4 | ((db_dg + 8) & 0x0F));
                                    out.push_back(b1);
                                    out.push_back(b2);
                                } else {
                                    out.push_back(0xFE);
                                    out.push_back(cur.r);
                                    out.push_back(cur.g);
                                    out.push_back(cur.b);
                                }
                            }
                        } else {
                            out.push_back(0xFF);
                            out.push_back(cur.r);
                            out.push_back(cur.g);
                            out.push_back(cur.b);
                            out.push_back(cur.a);
                        }
                    }
                }
                upper_left_saved = above;    
                row_buffer[x] = cur;         
                prev = cur;
            }
        }
        if (run > 0) {
            out.push_back(static_cast<unsigned char>(0xC0 + (run - 1)));
        }
        const unsigned char end_marker[8] = {0, 0, 0, 0, 0, 0, 0, 1};
        out.insert(out.end(), end_marker, end_marker + 8);
        return out;
    }
};
class QoiPlusDecoder {
private:
    static uint32_t read_u32_be(const std::vector<unsigned char>& data, size_t& idx) {
        uint32_t v = (static_cast<uint32_t>(data[idx])     << 24) |
                     (static_cast<uint32_t>(data[idx + 1]) << 16) |
                     (static_cast<uint32_t>(data[idx + 2]) << 8)  |
                     (static_cast<uint32_t>(data[idx + 3]));
        idx += 4;
        return v;
    }
public:
    Image decode(const std::vector<unsigned char>& qoi_data) {
        using namespace qoiplus_detail;
        if (qoi_data.size() < 14) return Image(0, 0, 0, {});
        size_t p = 0;
        if (qoi_data[p] != 0x71 || qoi_data[p+1] != 0x6F ||
            qoi_data[p+2] != 0x69 || qoi_data[p+3] != 0x2B)
            return Image(0, 0, 0, {});
        p += 4;
        uint32_t width  = read_u32_be(qoi_data, p);
        uint32_t height = read_u32_be(qoi_data, p);
        unsigned char channels  = qoi_data[p++];
        unsigned char colorspace = qoi_data[p++];
        (void)channels;
        (void)colorspace;
        size_t num_pixels = static_cast<size_t>(width) * static_cast<size_t>(height);
        std::vector<unsigned char> out;
        out.reserve(num_pixels * 4);
        Rgba index[256] = {};
        Rgba px   = {0, 0, 0, 255};  
        Rgba prev = {0, 0, 0, 255};  
        std::vector<Rgba> row_buffer(width, {0, 0, 0, 255});
        const size_t data_end = (qoi_data.size() >= 8) ? qoi_data.size() - 8 : 0;
        int x_pos = 0;
        int y_pos = 0;
        Rgba upper_left_saved = {0, 0, 0, 255};
        auto get_prediction = [&]() -> Rgba {
            Rgba above = row_buffer[x_pos];
            if (y_pos == 0 && x_pos == 0) return {0, 0, 0, 255};
            if (y_pos == 0)               return prev;
            if (x_pos == 0)               return above;
            return paeth_predict(prev, above, upper_left_saved);
        };
        auto emit_pixel = [&](const Rgba& pixel) {
            out.push_back(pixel.r);
            out.push_back(pixel.g);
            out.push_back(pixel.b);
            out.push_back(pixel.a);
            int h = hash_256(pixel);
            index[h] = pixel;
            Rgba above = row_buffer[x_pos];
            upper_left_saved = above;
            row_buffer[x_pos] = pixel;
            prev = pixel;
            x_pos++;
            if (x_pos >= (int)width) {
                x_pos = 0;
                y_pos++;
                upper_left_saved = {0, 0, 0, 255};
            }
        };
        px = {0, 0, 0, 255};
        prev = {0, 0, 0, 255};
        while (out.size() < num_pixels * 4 && p < data_end) {
            unsigned char b1 = qoi_data[p++];
            if (b1 == 0xFF) {
                Rgba predicted = get_prediction();
                (void)predicted;
                px.r = qoi_data[p++];
                px.g = qoi_data[p++];
                px.b = qoi_data[p++];
                px.a = qoi_data[p++];
                emit_pixel(px);
            }
            else if (b1 == 0xFE) {
                Rgba predicted = get_prediction();
                px.r = qoi_data[p++];
                px.g = qoi_data[p++];
                px.b = qoi_data[p++];
                px.a = predicted.a;
                emit_pixel(px);
            }
            else if (b1 == 0xFD) {
                continue;
            }
            else if (b1 == 0xFC) {
                Rgba predicted = get_prediction();
                (void)predicted;
                unsigned char idx = qoi_data[p++];
                px = index[idx];
                emit_pixel(px);
            }
            else if (b1 >= 0xC0) {
                int run_len = (b1 - 0xC0) + 1;
                for (int k = 0; k < run_len && out.size() < num_pixels * 4; ++k) {
                    emit_pixel(prev);
                }
            }
            else {
                unsigned char tag = b1 & 0xC0;
                if (tag == 0x00) {
                    Rgba predicted = get_prediction();
                    (void)predicted;
                    unsigned char idx = b1 & 0x3F;
                    px = index[idx];
                    emit_pixel(px);
                }
                else if (tag == 0x40) {
                    Rgba predicted = get_prediction();
                    int dr = ((b1 >> 4) & 0x03) - 2;
                    int dg = ((b1 >> 2) & 0x03) - 2;
                    int db = (b1 & 0x03) - 2;
                    px.r = static_cast<uint8_t>(static_cast<int>(predicted.r) + dr);
                    px.g = static_cast<uint8_t>(static_cast<int>(predicted.g) + dg);
                    px.b = static_cast<uint8_t>(static_cast<int>(predicted.b) + db);
                    px.a = predicted.a;  
                    emit_pixel(px);
                }
                else if (tag == 0x80) {
                    Rgba predicted = get_prediction();
                    unsigned char b2 = qoi_data[p++];
                    int dg = (b1 & 0x3F) - 32;
                    int dr_dg = ((b2 >> 4) & 0x0F) - 8;
                    int db_dg = (b2 & 0x0F) - 8;
                    px.r = static_cast<uint8_t>(static_cast<int>(predicted.r) + dg + dr_dg);
                    px.g = static_cast<uint8_t>(static_cast<int>(predicted.g) + dg);
                    px.b = static_cast<uint8_t>(static_cast<int>(predicted.b) + dg + db_dg);
                    px.a = predicted.a;  
                    emit_pixel(px);
                }
                else {
                    break; 
                }
            }
        }
        return Image(static_cast<int>(width), static_cast<int>(height), 4, std::move(out));
    }
};