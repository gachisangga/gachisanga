// src/screens/MapScreen.js
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  Keyboard,
  ActivityIndicator,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { getCoordsByAddress } from "../api/kakaoApi";
import { getStoresInRadius } from "../api/StoresInRadius";
import { getAdmmCdByDong } from "../api/lawDongApi";
import { getPopulationByDong } from "../api/populationApi";

// 유틸
import { buildRecommendPayload } from "../utils/buildRecommendPayload";
import { fetchRecommendations } from "../utils/fetchRecommendations";

const MapScreen = () => {
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState(null);

  // 전체 응답 저장 (topCategories + why + debug)
  const [recoData, setRecoData] = useState(null);

  // UX 보강
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  const handleSearch = async () => {
    if (!address.trim() || loading) return;
    setErrMsg(null);
    setLoading(true);
    Keyboard.dismiss();

    try {
      // 1) 주소 → 좌표
      const result = await getCoordsByAddress(address);
      console.log("검색 결과:", result);
      if (!result) {
        setErrMsg("주소를 찾지 못했습니다.");
        setLoading(false);
        return;
      }
      setCoords(result);

      // 2) 반경 내 상가 조회
      const stores = await getStoresInRadius(result);
      console.log("주변 상가 리스트:", stores);

      // 3) 주소명 → 행정동 코드
      const { fullDongName } = result;
      console.log("카카오에서 받은 fullDongName:", fullDongName);
      const parts = (fullDongName || "").split(" ").filter(Boolean);
      const dongName = parts.length ? parts[parts.length - 1] : undefined;
      const admmCd = await getAdmmCdByDong(fullDongName);
      console.log("변환된 admmCd:", admmCd);

      // (선택) 인구 API 조회 – 백엔드가 자체 조회하므로 없어도 추천 동작함
      if (admmCd) {
        const population = await getPopulationByDong(admmCd, dongName);
        console.log("인구 데이터(프론트):", population);
      }

      // 4) 추천 API 호출
      const kakaoAddrObj = {
        x: String(result.longitude), // 경도
        y: String(result.latitude),  // 위도
        b_code: undefined,
        region_2depth_name: pickGuFromFull(fullDongName), // "용산구" 등
      };

      const payload = buildRecommendPayload({
        kakaoAddr: kakaoAddrObj,
        storesResp: stores,
        areaCd: undefined, // 있으면 넣기
        topK: 5,
      });

      const rec = await fetchRecommendations(payload); // { topCategories, why?, debug? }
      console.log("추천 결과 원본:", JSON.stringify(rec, null, 2));

      setRecoData(rec);
    } catch (e) {
      console.warn("추천 호출 실패:", e?.message ?? e);
      setErrMsg(e?.message || "요청 중 오류가 발생했습니다.");
      setRecoData(null);
    } finally {
      setLoading(false);
    }
  };

  // Why 라인(서버 우선, 없으면 폴백)
  const whyLine = recoData?.why?.line ?? buildWhyFallback(recoData) ?? null;

  // ★ Why 상세(서버 우선, 없으면 debug로 폴백 생성)
  const d = recoData?.why?.details ?? buildDetailsFallback(recoData) ?? null;

  // Top-K 목록
  const top = Array.isArray(recoData?.topCategories) ? recoData.topCategories : [];

  // 지도 영역
  const region = coords
    ? {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }
    : {
        latitude: 37.5665,
        longitude: 126.978,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };

  return (
    <View style={{ flex: 1 }}>
      {/* 지도 */}
      <MapView style={{ flex: 1 }} region={region}>
        {coords && <Marker coordinate={{ latitude: coords.latitude, longitude: coords.longitude }} />}
      </MapView>

      {/* 결과 패널 */}
      {(loading || errMsg || whyLine || top.length > 0) && (
        <View style={styles.recoContainer}>
          {/* 로딩 */}
          {loading && (
            <View style={styles.rowCenter}>
              <ActivityIndicator />
              <Text style={{ marginLeft: 8, fontSize: 12 }}>분석 중…</Text>
            </View>
          )}

          {/* 에러 */}
          {!loading && errMsg && (
            <Text style={{ color: "#B91C1C", marginBottom: 6, fontSize: 12 }}>{errMsg}</Text>
          )}

          {/* Why 배지 */}
          {!loading && !errMsg && whyLine ? (
            <View style={styles.whyBadge}>
              <Text style={styles.whyText}>{whyLine}</Text>
            </View>
          ) : null}

          {/* 상세 근거 섹션 */}
          {!loading && !errMsg && d ? (
            <View>
              {/* 인구/연령 */}
              <Text style={styles.sectionTitle}>인구·연령</Text>
              <Text style={styles.item}>
                {d.demographics?.female?.label}
                {" · "}
                {d.demographics?.age20s?.label}
                {" · "}
                {d.demographics?.age30s?.label}
              </Text>

              {/* 상권/결제 */}
              <Text style={styles.sectionTitle}>상권/결제</Text>
              {d.commerce?.notes ? (
                <Text style={styles.item}>{d.commerce.notes}</Text>
              ) : (
                <Text style={styles.item}>
                  결제강도(log) {fmtNum(d.commerce?.pay_cnt_log)} · 상권레벨 {fmtNum(d.commerce?.cmrcl_level)}
                </Text>
              )}

              {/* 업종 분포 */}
              <Text style={styles.sectionTitle}>업종 분포</Text>
              <Text style={styles.item}>
                총 {d.poi?.total ?? 0}개 · 다양도(entropy) {fmtNum(d.poi?.entropy)}
              </Text>

              {/* 표본 적으면 안내 */}
              {(d.poi?.total ?? 0) < 5 ? (
                <Text style={styles.item}>표본이 적어 상위/하위 업종 비교는 생략했어요.</Text>
              ) : (
                <>
                  {/* 많은 업종 Top 3 */}
                  {Array.isArray(d.poi?.topMost) && d.poi.topMost.length > 0 && (
                    <>
                      <Text style={styles.subTitle}>많은 업종 Top 3</Text>
                      {d.poi.topMost.slice(0, 3).map((x) => (
                        <Text key={`top-${x.category}`} style={styles.item}>
                          • {x.category} {fmtPct(x.share)} ({x.count})
                        </Text>
                      ))}
                    </>
                  )}

                  {/* 적은 업종 Top 3 (중복 제거) */}
                  {Array.isArray(d.poi?.leastCommon) && d.poi.leastCommon.length > 0 && (
                    <>
                      <Text style={styles.subTitle}>적은 업종 Top 3</Text>
                      {d.poi.leastCommon
                        .filter((x) => !d.poi.topMost?.some?.((y) => y.category === x.category))
                        .slice(0, 3)
                        .map((x) => (
                          <Text key={`low-${x.category}`} style={styles.item}>
                            • {x.category} {fmtPct(x.share)} ({x.count})
                          </Text>
                        ))}
                    </>
                  )}
                </>
              )}

              {/* 경쟁도 */}
              <Text style={styles.sectionTitle}>경쟁도</Text>
              <Text style={styles.item}>
                {d.poi?.competition?.topCategory
                  ? `${d.poi.competition.topCategory} 업종 비중 ${fmtPct(d.poi.competition.sameShare)} (${d.poi.competition.sameCount}/${d.poi?.total}) · ${d.poi.competition.label}`
                  : "분석 불가"}
              </Text>
            </View>
          ) : null}

          {/* 추천 업종 리스트 */}
          {!loading && !errMsg && top.length > 0 ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.recoTitle}>추천 업종</Text>
              {top.map((r) => (
                <Text key={`${r.category}`} style={styles.recoItem}>
                  • {r.category}{" "}
                  <Text style={styles.recoScore}>
                    {typeof r.score === "number" ? r.score.toFixed(3) : String(r.score)}
                  </Text>
                </Text>
              ))}
            </>
          ) : null}
        </View>
      )}

      {/* 주소 입력칸 + 버튼 */}
      <View style={styles.inputContainer}>
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="상세주소 입력"
          style={styles.input}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <Button title={loading ? "검색 중…" : "검색"} onPress={handleSearch} disabled={loading} />
      </View>
    </View>
  );
};

/** Why 폴백(서버가 why.line을 못 줄 때) */
function buildWhyFallback(rec) {
  try {
    if (!rec) return null;
    const fv = rec?.debug?.featureVector || {};
    const byCate = rec?.debug?.poi?.byCate || {};
    const top0 = rec?.topCategories?.[0];
    const topCategory = top0?.category;
    if (!topCategory) return null;

    const {
      rate_20s = 0, rate_30s = 0, female_rate = 0,
      cmrcl_level = 0, pay_cnt_log = 0, poi_entropy = 0
    } = fv;

    const reasons = [];
    if (rate_20s >= 0.22) reasons.push("20대 비중 높음");
    if (rate_30s >= 0.20) reasons.push("30대 비중 높음");
    if (female_rate >= 0.50) reasons.push("여성 비중 높음");

    const payHigh = pay_cnt_log >= 6.0;
    const payMid  = pay_cnt_log >= 5.0;
    const lvlHigh = cmrcl_level >= 0.60;
    const lvlMid  = cmrcl_level >= 0.30;
    if (payHigh || lvlHigh) reasons.push("결제활동 상위권");
    else if (payMid || lvlMid) reasons.push("상권 활력 보통");

    if (poi_entropy >= 1.5) reasons.push("업종 다양도 높음");

    const total = Object.values(byCate).reduce((a, b) => a + b, 0) || 1;
    const same = byCate[topCategory] || 0;
    const share = same / total;
    if (share >= 0.50) reasons.push("동일 업종 과밀");
    else if (share <= 0.20 && total > 3) reasons.push("동일 업종 드묾");

    const left = reasons.length ? `이 지역은 ${reasons.join(" + ")}` : "이 지역은";
    return `${left} → ${topCategory} 추천`;
  } catch {
    return null;
  }
}

/** details 폴백(서버가 why.details를 안 줄 때 debug로 구성) */
function buildDetailsFallback(rec) {
  try {
    if (!rec) return null;
    const fv = rec?.debug?.featureVector || {};
    const byCate = rec?.debug?.poi?.byCate || {};
    const top0 = rec?.topCategories?.[0];
    const topCategory = top0?.category || null;

    const {
      rate_20s = 0, rate_30s = 0, female_rate = 0,
      cmrcl_level = 0, pay_cnt_log = 0, poi_entropy = 0, poi_total = 0
    } = fv;

    const total = Object.values(byCate).reduce((a, b) => a + b, 0) || 1;
    const same = topCategory ? (byCate[topCategory] || 0) : 0;
    const share = same / total;

    const entries = Object.entries(byCate).sort((a, b) => b[1] - a[1]);
    const topMost = entries.slice(0, 5).map(([k, v]) => ({ category: k, count: v, share: v / total }));
    const leastCommon = entries.slice(-5).map(([k, v]) => ({ category: k, count: v, share: v / total }));

    const TH = {
      RATE20S_HIGH: 0.22, RATE30S_HIGH: 0.20, FEMALE_RATE_HIGH: 0.50,
      PAY_LOG_HIGH: 6.0, PAY_LOG_MID: 5.0, CMR_LEVEL_HIGH: 0.60, CMR_LEVEL_MID: 0.30,
      ENTROPY_HIGH: 1.5, COMP_OVER: 0.50, COMP_UNDER: 0.20, COMP_MIN_TOTAL: 3,
    };

    const pct = (x) => `${(x * 100).toFixed(1)}%`;

    return {
      demographics: {
        female: { value: female_rate, label: `여성 ${pct(female_rate)}` },
        age20s: { value: rate_20s, label: `20대 ${pct(rate_20s)}` },
        age30s: { value: rate_30s, label: `30대 ${pct(rate_30s)}` },
        flags: {
          femaleHigh: female_rate >= TH.FEMALE_RATE_HIGH,
          age20sHigh: rate_20s >= TH.RATE20S_HIGH,
          age30sHigh: rate_30s >= TH.RATE30S_HIGH,
        },
      },
      commerce: {
        cmrcl_level,
        pay_cnt_log,
        notes: (pay_cnt_log === 0 && cmrcl_level === 0) ? "상권(결제) 데이터 없음/부족" : undefined,
        flags: {
          payHigh: pay_cnt_log >= TH.PAY_LOG_HIGH,
          payMid:  pay_cnt_log >= TH.PAY_LOG_MID,
          lvlHigh: cmrcl_level >= TH.CMR_LEVEL_HIGH,
          lvlMid:  cmrcl_level >= TH.CMR_LEVEL_MID,
        },
      },
      poi: {
        total: poi_total,
        entropy: poi_entropy,
        topMost,
        leastCommon,
        competition: {
          topCategory,
          sameCount: same,
          sameShare: share,
          label:
            share >= TH.COMP_OVER
              ? "동일 업종 과밀"
              : (share <= TH.COMP_UNDER && total > TH.COMP_MIN_TOTAL) ? "동일 업종 드묾" : "보통",
        },
        flags: { highDiversity: poi_entropy >= TH.ENTROPY_HIGH },
      },
    };
  } catch {
    return null;
  }
}

function pickGuFromFull(full) {
  if (!full) return null;
  const parts = full.split(" ").filter(Boolean); // 예: ["서울특별시","용산구","서계동"]
  return parts.length >= 2 ? parts[1] : null;
}

/** 표시용 유틸 */
function fmtNum(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n.toFixed(2) : "-";
}
function fmtPct(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "-";
}

const styles = StyleSheet.create({
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    marginRight: 10,
    padding: 8,
    borderRadius: 5,
  },
  recoContainer: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 70,
    backgroundColor: "white",
    padding: 12,
    borderRadius: 10,
    elevation: 5,
  },
  rowCenter: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  // why 배지 스타일
  whyBadge: {
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  whyText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  sectionTitle: { marginTop: 10, fontWeight: "700" },
  subTitle: { marginTop: 6, fontWeight: "600" },
  item: { fontSize: 12, color: "#111", marginTop: 2 },
  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 8,
  },
  recoTitle: { fontWeight: "700", marginBottom: 6 },
  recoItem: { fontSize: 14, marginVertical: 2 },
  recoScore: { color: "#666", fontSize: 12 },
});

export default MapScreen;
