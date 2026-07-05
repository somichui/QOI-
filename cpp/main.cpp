#include <iostream>
#include <string>
#include <vector>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <cstdint>
#include <algorithm>
#include <SDL2/SDL.h>
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"
#include "qoi_core.h"
class ImageFromFile : public Image {
public:
    ImageFromFile(const std::string& filepath)
        : Image(0, 0, 0, {})
    {
        int w = 0, h = 0, orig_chan = 0;
        unsigned char* data = stbi_load(filepath.c_str(), &w, &h, &orig_chan, 4);
        if (!data) return;
        std::vector<unsigned char> px(data, data + (w * h * 4));
        stbi_image_free(data);
        *static_cast<Image*>(this) = Image(w, h, 4, std::move(px));
    }
};
SDL_Texture* loadAndProcessImage(SDL_Renderer* renderer, SDL_Window* window, const std::string& filepath) {
    std::string ext = fs::getExtension(filepath);
    SDL_Texture* texture = nullptr;
    std::unique_ptr<Image> image_obj;
    if (ext == ".qoi") {
        std::vector<unsigned char> data = read_file(filepath);
        if (data.empty()) return nullptr;
        QoiDecoder dec;
        Image decoded = dec.decode(data);
        if (!decoded.isValid()) return nullptr;
        image_obj = std::make_unique<Image>(std::move(decoded));
    }
    else if (ext == ".qoiplus") {
        std::vector<unsigned char> data = read_file(filepath);
        if (data.empty()) return nullptr;
        QoiPlusDecoder dec;
        Image decoded = dec.decode(data);
        if (!decoded.isValid()) return nullptr;
        image_obj = std::make_unique<Image>(std::move(decoded));
    }
    else if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".bmp") {
        image_obj = std::make_unique<ImageFromFile>(filepath);
        if (!image_obj->isValid()) return nullptr;
        QoiEncoder enc;
        std::vector<unsigned char> qoi = enc.encode(*image_obj);
        std::string out = fs::changeExtension(filepath, ".qoi");
        write_file(out, qoi);
    }
    else return nullptr;
    if (image_obj && image_obj->isValid()) {
        int w = image_obj->getWidth(), h = image_obj->getHeight();
        size_t num_pixels = static_cast<size_t>(w) * static_cast<size_t>(h);
        const auto &src = image_obj->getPixels();
        SDL_PixelFormat* fmt = SDL_AllocFormat(SDL_PIXELFORMAT_ARGB8888);
        if (!fmt) return nullptr;
        std::vector<uint32_t> mapped(num_pixels);
        for (size_t i = 0; i < num_pixels; ++i) {
            uint8_t r = src[i*4 + 0];
            uint8_t g = src[i*4 + 1];
            uint8_t b = src[i*4 + 2];
            uint8_t a = src[i*4 + 3];
            mapped[i] = SDL_MapRGBA(fmt, r, g, b, a);
        }
        SDL_FreeFormat(fmt);
        texture = SDL_CreateTexture(renderer, SDL_PIXELFORMAT_ARGB8888, SDL_TEXTUREACCESS_STATIC, w, h);
        if (!texture) return nullptr;
        int pitch = w * 4;
        if (SDL_UpdateTexture(texture, nullptr, mapped.data(), pitch) != 0) {
            SDL_DestroyTexture(texture);
            return nullptr;
        }
        SDL_SetWindowTitle(window, filepath.c_str());
        SDL_SetWindowSize(window, w, h);
    }
    return texture;
}
int main(int argc, char* argv[]) {
    if (SDL_Init(SDL_INIT_VIDEO) != 0) return 1;
    SDL_EventState(SDL_DROPFILE, SDL_ENABLE);
    SDL_Window* window = SDL_CreateWindow("QOI C++ Project", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, 640, 480, SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE);
    if (!window) { SDL_Quit(); return 1; }
    SDL_Renderer* renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED);
    if (!renderer) { SDL_DestroyWindow(window); SDL_Quit(); return 1; }
    SDL_Texture* currentTexture = nullptr;
    if (argc > 1) currentTexture = loadAndProcessImage(renderer, window, argv[1]);
    bool running = true;
    SDL_Event event;
    while (running) {
        while (SDL_PollEvent(&event)) {
            switch (event.type) {
                case SDL_QUIT: running = false; break;
                case SDL_DROPFILE: {
                    char* dropped = event.drop.file;
                    if (currentTexture) { SDL_DestroyTexture(currentTexture); currentTexture = nullptr; }
                    currentTexture = loadAndProcessImage(renderer, window, dropped);
                    SDL_free(dropped);
                    break;
                }
            }
        }
        SDL_SetRenderDrawColor(renderer, 20, 20, 20, 255);
        SDL_RenderClear(renderer);
        if (currentTexture) SDL_RenderCopy(renderer, currentTexture, nullptr, nullptr);
        SDL_RenderPresent(renderer);
    }
    if (currentTexture) SDL_DestroyTexture(currentTexture);
    SDL_DestroyRenderer(renderer);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}