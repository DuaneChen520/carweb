package com.carweb.appinfo;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.drawable.Drawable;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

public class AppInfoFetcher {
    public static void main(String[] args) {
        try {
            // 获取PackageManager实例
            PackageManager pm = getPackageManager();
            
            // 获取所有已安装应用
            List<PackageInfo> packages = pm.getInstalledPackages(0);
            
            // 构建结果
            List<AppInfo> apps = new ArrayList<>();
            List<AppError> errors = new ArrayList<>();
            
            for (PackageInfo pkg : packages) {
                try {
                    // 获取应用标签
                    String label = pkg.applicationInfo.loadLabel(pm).toString();
                    
                    // 获取应用图标并转换为Base64
                    String iconBase64 = null;
                    Drawable icon = pkg.applicationInfo.loadIcon(pm);
                    if (icon != null) {
                        iconBase64 = drawableToBase64(icon);
                    }
                    
                    // 构建AppInfo对象
                    AppInfo appInfo = new AppInfo();
                    appInfo.packageName = pkg.packageName;
                    appInfo.label = label;
                    appInfo.iconBase64 = iconBase64;
                    appInfo.versionCode = pkg.versionCode;
                    
                    apps.add(appInfo);
                } catch (Exception e) {
                    AppError error = new AppError();
                    error.packageName = pkg.packageName;
                    error.error = e.getMessage();
                    errors.add(error);
                }
            }
            
            // 输出JSON结果
            JsonResult result = new JsonResult();
            result.apps = apps;
            result.errors = errors;
            
            System.out.println(toJson(result));
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
            System.exit(1);
        }
    }
    
    private static PackageManager getPackageManager() {
        Throwable lastException = null;

        // 先初始化 Looper（app_process 的 main thread 没有 Looper）
        try {
            Class<?> looperClass = Class.forName("android.os.Looper");
            looperClass.getMethod("prepare").invoke(null);
            System.err.println("[INIT] Looper.prepare() done");
        } catch (Throwable e) {
            System.err.println("[INIT] Looper.prepare() failed: " + e.getMessage());
        }

        // 方法1: systemMain()
        try {
            System.err.println("[M1] calling systemMain...");
            Class<?> atClass = Class.forName("android.app.ActivityThread");
            Object at = atClass.getMethod("systemMain").invoke(null);
            System.err.println("[M1] at=" + (at != null));

            Object ctx = atClass.getMethod("getSystemContext").invoke(at);
            System.err.println("[M1] ctx=" + (ctx != null));

            if (ctx != null) {
                Object pm = ctx.getClass().getMethod("getPackageManager").invoke(ctx);
                System.err.println("[M1] pm=" + (pm != null));
                if (pm != null) return (PackageManager) pm;
            }
        } catch (Throwable e) {
            lastException = e;
            System.err.println("[M1] FAIL: " + e.getClass().getSimpleName());
            Throwable cause = e.getCause();
            while (cause != null) {
                System.err.println("[M1]   CAUSE: " + cause.getClass().getSimpleName() + ": " + cause.getMessage());
                cause = cause.getCause();
            }
        }

        // 方法2: 使用构造函数 + attach (某些设备需要)
        try {
            System.err.println("[M2] creating ActivityThread...");
            Class<?> atClass = Class.forName("android.app.ActivityThread");
            java.lang.reflect.Constructor<?> ctor = atClass.getDeclaredConstructor();
            ctor.setAccessible(true);
            Object at = ctor.newInstance();
            System.err.println("[M2] at=" + (at != null));

            java.lang.reflect.Method attachMethod = atClass.getDeclaredMethod("attach", boolean.class);
            attachMethod.setAccessible(true);
            attachMethod.invoke(at, true);
            System.err.println("[M2] attach done");

            Object ctx = atClass.getMethod("getSystemContext").invoke(at);
            System.err.println("[M2] ctx=" + (ctx != null));

            if (ctx != null) {
                Object pm = ctx.getClass().getMethod("getPackageManager").invoke(ctx);
                System.err.println("[M2] pm=" + (pm != null));
                if (pm != null) return (PackageManager) pm;
            }
        } catch (Throwable e) {
            lastException = e;
            System.err.println("[M2] FAIL: " + e.getClass().getSimpleName());
            Throwable cause = e.getCause();
            while (cause != null) {
                System.err.println("[M2]   CAUSE: " + cause.getClass().getSimpleName() + ": " + cause.getMessage());
                cause = cause.getCause();
            }
        }

        // 方法3: 使用ContextImpl.createSystemContext (某些ROM需要)
        try {
            System.err.println("[M3] creating ActivityThread...");
            Class<?> atClass = Class.forName("android.app.ActivityThread");
            java.lang.reflect.Constructor<?> ctor = atClass.getDeclaredConstructor();
            ctor.setAccessible(true);
            Object at = ctor.newInstance();
            System.err.println("[M3] at=" + (at != null));

            System.err.println("[M3] calling ContextImpl.createSystemContext...");
            Class<?> contextImplClass = Class.forName("android.app.ContextImpl");
            java.lang.reflect.Method createSystemContext = contextImplClass.getMethod("createSystemContext", atClass);
            Object ctx = createSystemContext.invoke(null, at);
            System.err.println("[M3] ctx=" + (ctx != null));

            if (ctx != null) {
                Object pm = ctx.getClass().getMethod("getPackageManager").invoke(ctx);
                System.err.println("[M3] pm=" + (pm != null));
                if (pm != null) return (PackageManager) pm;
            }
        } catch (Throwable e) {
            lastException = e;
            System.err.println("[M3] FAIL: " + e.getClass().getSimpleName());
            Throwable cause = e.getCause();
            while (cause != null) {
                System.err.println("[M3]   CAUSE: " + cause.getClass().getSimpleName() + ": " + cause.getMessage());
                cause = cause.getCause();
            }
        }

        // 所有方法都失败，抛出异常，打印完整原因链
        System.err.println("=== Full cause chain ===");
        printCauseChain(lastException);
        throw new RuntimeException("Failed to get PackageManager - all initialization methods failed", lastException);
    }

    private static void printCauseChain(Throwable t) {
        int depth = 0;
        while (t != null && depth < 5) {
            System.err.println("  [" + depth + "] " + t.getClass().getSimpleName() + ": " + 
                (t.getMessage() != null ? t.getMessage() : "(no message)"));
            t = t.getCause();
            depth++;
        }
    }
    
    private static String drawableToBase64(Drawable drawable) {
        Bitmap bitmap = null;
        ByteArrayOutputStream outputStream = null;
        try {
            int width = drawable.getIntrinsicWidth();
            int height = drawable.getIntrinsicHeight();
            if (width <= 0 || height <= 0) {
                System.err.println("Warning: Invalid drawable dimensions: " + width + "x" + height);
                return null;
            }
            
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            android.graphics.Canvas canvas = new android.graphics.Canvas(bitmap);
            drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
            drawable.draw(canvas);
            
            outputStream = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 85, outputStream);
            
            byte[] bytes = outputStream.toByteArray();
            return Base64.encodeToString(bytes, Base64.NO_WRAP);
        } catch (Exception e) {
            System.err.println("Warning: Failed to convert drawable to base64: " + e.getMessage());
            return null;
        } finally {
            if (outputStream != null) {
                try { outputStream.close(); } catch (Exception ignored) {}
            }
            if (bitmap != null && !bitmap.isRecycled()) {
                bitmap.recycle();
            }
        }
    }
    
    private static String toJson(JsonResult result) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"apps\":[");
        
        for (int i = 0; i < result.apps.size(); i++) {
            AppInfo app = result.apps.get(i);
            if (i > 0) sb.append(",");
            sb.append("{");
            sb.append("\"packageName\":\"").append(escapeJson(app.packageName)).append("\",");
            sb.append("\"label\":\"").append(escapeJson(app.label)).append("\",");
            sb.append("\"iconBase64\":").append(app.iconBase64 != null ? "\"" + app.iconBase64 + "\"" : "null").append(",");
            sb.append("\"versionCode\":").append(app.versionCode);
            sb.append("}");
        }
        
        sb.append("],\"errors\":[");
        
        for (int i = 0; i < result.errors.size(); i++) {
            AppError error = result.errors.get(i);
            if (i > 0) sb.append(",");
            sb.append("{");
            sb.append("\"packageName\":\"").append(escapeJson(error.packageName)).append("\",");
            sb.append("\"error\":\"").append(escapeJson(error.error)).append("\"");
            sb.append("}");
        }
        
        sb.append("]}");
        return sb.toString();
    }
    
    private static String escapeJson(String str) {
        if (str == null) return "";
        return str.replace("\\", "\\\\")
                  .replace("\"", "\\\"")
                  .replace("\n", "\\n")
                  .replace("\r", "\\r")
                  .replace("\t", "\\t");
    }
    
    // 内部类定义
    static class AppInfo {
        public String packageName;
        public String label;
        public String iconBase64;
        public int versionCode;
    }
    
    static class AppError {
        public String packageName;
        public String error;
    }
    
    static class JsonResult {
        public List<AppInfo> apps;
        public List<AppError> errors;
    }
}
