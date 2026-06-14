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
        // 通过反射获取PackageManager实例
        // 这是在app_process环境中获取PackageManager的标准方法
        try {
            Class<?> activityThread = Class.forName("android.app.ActivityThread");
            Object systemMain = activityThread.getMethod("systemMain").invoke(null);
            return (PackageManager) systemMain.getClass().getMethod("getPackageManager").invoke(systemMain);
        } catch (Exception e) {
            throw new RuntimeException("Failed to get PackageManager", e);
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
