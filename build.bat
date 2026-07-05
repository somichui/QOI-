@echo off
echo ============================================
echo  QOI+ WebAssembly Build
echo ============================================
echo.

:: Check if emcc is available
where emcc >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Emscripten (emcc) not found in PATH.
    echo.
    echo To install Emscripten:
    echo   git clone https://github.com/emscripten-core/emsdk.git
    echo   cd emsdk
    echo   emsdk install latest
    echo   emsdk activate latest
    echo   emsdk_env.bat
    echo.
    echo Then run this script again.
    exit /b 1
)

echo [1/2] Compiling C++ to WebAssembly...
emcc cpp/qoi_wasm.cpp -O3 --bind -o docs/qoi_core.js ^
    -s WASM=1 ^
    -s ALLOW_MEMORY_GROWTH=1 ^
    -s MODULARIZE=1 ^
    -s EXPORT_NAME=QoiModule ^
    -s ENVIRONMENT=web,worker ^
    -std=c++17 ^
    -I cpp/

if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Compilation failed.
    exit /b 1
)

echo [2/2] Build complete!
echo.
echo Output files:
echo   docs/qoi_core.js    (WASM glue code)
echo   docs/qoi_core.wasm  (compiled C++)
echo.
echo To run locally:
echo   cd docs
echo   python -m http.server 8080
echo   Open http://localhost:8080
echo.
echo ============================================
