#!/bin/bash
set -e
# build.sh - 编译Java代码为DEX文件

# 设置Android SDK路径（需要根据实际环境调整）
ANDROID_SDK=${ANDROID_SDK:-$ANDROID_HOME}
if [ -z "$ANDROID_SDK" ]; then
    echo "Error: ANDROID_SDK or ANDROID_HOME environment variable is not set"
    exit 1
fi

D8_DIR="$ANDROID_SDK/build-tools/34.0.0"

# 创建输出目录
mkdir -p build

run_d8() {
    if [ -f "$D8_DIR/d8.bat" ]; then
        cmd.exe /c "$(cygpath -w "$D8_DIR/d8.bat")" "$@"
    elif [ -f "$D8_DIR/d8" ]; then
        "$D8_DIR/d8" "$@"
    else
        echo "Error: d8 tool not found in $D8_DIR"
        exit 1
    fi
}

# ==================== 编译完整版 DEX ====================
echo "=== Building AppInfoFetcher (full) ==="
rm -rf build/com build/classes.dex

javac -source 1.8 -target 1.8 -bootclasspath "$ANDROID_SDK/platforms/android-34/android.jar" \
    -d build AppInfoFetcher.java

if [ $? -ne 0 ]; then
    echo "Error: AppInfoFetcher.java compilation failed"
    exit 1
fi

run_d8 --output build --lib "$ANDROID_SDK/platforms/android-34/android.jar" build/com/carweb/appinfo/*.class

if [ $? -ne 0 ]; then
    echo "Error: DEX conversion failed"
    exit 1
fi

mv build/classes.dex build/app-info-fetcher.dex
echo "Build successful: build/app-info-fetcher.dex"

# ==================== 编译快速版 DEX ====================
echo "=== Building AppInfoFetcherQuick ==="
rm -rf build/com build/classes.dex

javac -source 1.8 -target 1.8 -bootclasspath "$ANDROID_SDK/platforms/android-34/android.jar" \
    -d build AppInfoFetcherQuick.java

if [ $? -ne 0 ]; then
    echo "Error: AppInfoFetcherQuick.java compilation failed"
    exit 1
fi

run_d8 --output build --lib "$ANDROID_SDK/platforms/android-34/android.jar" build/com/carweb/appinfo/*.class

if [ $? -ne 0 ]; then
    echo "Error: Quick DEX conversion failed"
    exit 1
fi

mv build/classes.dex build/app-info-fetcher-quick.dex
echo "Build successful: build/app-info-fetcher-quick.dex"

echo "=== All builds complete ==="
ls -la build/*.dex
