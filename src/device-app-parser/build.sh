#!/bin/bash
set -e
# build.sh - 编译Java代码为DEX文件

# 设置Android SDK路径（需要根据实际环境调整）
ANDROID_SDK=${ANDROID_SDK:-$ANDROID_HOME}
if [ -z "$ANDROID_SDK" ]; then
    echo "Error: ANDROID_SDK or ANDROID_HOME environment variable is not set"
    exit 1
fi

# 创建输出目录
mkdir -p build

# 编译Java代码
echo "Compiling Java code..."
javac -source 1.8 -target 1.8 -bootclasspath "$ANDROID_SDK/platforms/android-34/android.jar" \
    -d build AppInfoFetcher.java

if [ $? -ne 0 ]; then
    echo "Error: Java compilation failed"
    exit 1
fi

# 转换为DEX格式（使用d8替代已废弃的dx）
echo "Converting to DEX format..."
"$ANDROID_SDK/build-tools/34.0.0/d8" --output build --lib "$ANDROID_SDK/platforms/android-34/android.jar" build/com/carweb/appinfo/*.class

if [ $? -ne 0 ]; then
    echo "Error: DEX conversion failed"
    exit 1
fi

# 重命名输出文件
mv build/classes.dex build/app-info-fetcher.dex

echo "Build successful: build/app-info-fetcher.dex"
