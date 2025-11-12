// utils/fetchRecommendations.js
import { Platform } from "react-native";

const DEFAULT_BASE =
  Platform.OS === "android"
    ? "http://10.0.2.2:3000"     // 안드로이드 에뮬레이터
    : "http://localhost:3000";   // iOS 시뮬레이터

// 실기기 테스트 시 .env(예: EXPO_PUBLIC_API_BASE)나 하드코딩 IP 사용:
// 예) http://192.168.0.23:3000
const API_BASE = process.env.EXPO_PUBLIC_API_BASE || DEFAULT_BASE;

export async function fetchRecommendations(payload) {
  // 간단 타임아웃(8초)
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${API_BASE}/api/v1/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    const data = await res.json();
    // 디버그: why 확인
    // console.log("why.line:", data?.why?.line);
    return data; // ★ 전체 응답 그대로 반환 (why 포함)
  } finally {
    clearTimeout(id);
  }
}
