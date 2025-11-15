// src/screens/MapScreen.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  Keyboard,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { getCoordsByAddress } from "../api/kakaoApi";
import { getStoresInRadius } from "../api/StoresInRadius";
import { getAdmmCdByDong } from "../api/lawDongApi";
import { getPopulationByDong } from "../api/populationApi";

// 유틸
import { buildRecommendPayload } from "../utils/buildRecommendPayload";
import { fetchRecommendations } from "../utils/fetchRecommendations";

/** ----------------------------------------------------------------------------
 * 서버 API 베이스 URL
 * ---------------------------------------------------------------------------*/
const RECO_API_BASE = "http://localhost:3000/api/v1"; // 필요하면 IP/포트 수정

/** ----------------------------------------------------------------------------
 * 카테고리 정책(프론트에서 필터링)
 * ---------------------------------------------------------------------------*/
const CATEGORY_META = {
  "카페/디저트": { openable: true, needsLicense: false, franchiseable: true },
  분식: { openable: true, needsLicense: false, franchiseable: true },
  패스트푸드: { openable: true, needsLicense: false, franchiseable: true },
  편의점: { openable: true, needsLicense: false, franchiseable: true },
  "뷰티/미용": {
    openable: true,
    needsLicense: true,
    franchiseable: true,
  }, // 일부 시술은 허가 필요
  한식: { openable: true, needsLicense: false, franchiseable: true },

  // 전문/허가 필요 — 일반 사용자는 보통 바로 개업 어려움
  보건의료: { openable: false, needsLicense: true, franchiseable: false },
  교육: { openable: false, needsLicense: true, franchiseable: true },
  부동산: { openable: false, needsLicense: true, franchiseable: false },
  숙박: { openable: false, needsLicense: true, franchiseable: true },

  // 기타(필요 시 추가/수정)
  "예술·스포츠": { openable: true, needsLicense: false, franchiseable: true },
  소매: { openable: true, needsLicense: false, franchiseable: true },
  음식: { openable: true, needsLicense: false, franchiseable: true },
};
const getMeta = (cat) =>
  CATEGORY_META[cat] ?? {
    openable: true,
    needsLicense: false,
    franchiseable: false,
  };

const MapScreen = () => {
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState(null);

  // 전체 응답 저장 (topCategories + why + debug)
  const [recoData, setRecoData] = useState(null);

  // UX 보강
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  // 탭(일반/허가) 스위치
  const [activeTab, setActiveTab] = useState("openable"); // "openable" | "licensed"

  // 사용자 분류 선택 (대/중분류)
  const [selectedL, setSelectedL] = useState(null); // 대분류
  const [selectedM, setSelectedM] = useState(null); // 중분류

  // 🔹 프랜차이즈(브랜드) 목록 상태
  const [brandList, setBrandList] = useState([]);
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandErr, setBrandErr] = useState(null);

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
        y: String(result.latitude), // 위도
        b_code: undefined,
        region_2depth_name: pickGuFromFull(fullDongName), // "용산구" 등
      };

      let payload = buildRecommendPayload({
        kakaoAddr: kakaoAddrObj,
        storesResp: stores,
        areaCd: undefined,
        topK: 10, // 넉넉히 받아오기 (각 그룹 5개 채우기 위해, 백엔드 max 10 이내)
      });

      // 🔹 (선택) 사용자가 선택한 대/중분류 → targetCate로 전송 (현재는 통계용/디버그용)
      let targetCate = null;
      if (selectedM) {
        targetCate = { level: "M", name: selectedM };
      } else if (selectedL) {
        targetCate = { level: "L", name: selectedL };
      }
      if (targetCate) {
        payload = { ...payload, targetCate };
      }

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

  // Why 상세(서버 우선, 없으면 debug로 폴백 생성)
  const d = recoData?.why?.details ?? buildDetailsFallback(recoData) ?? null;

  // Top-K 목록 (백엔드: 항상 "소분류" 기준으로 옴)
  const top = Array.isArray(recoData?.topCategories)
    ? recoData.topCategories
    : [];

  // taxonomy (백엔드 debug.taxonomy → 대/중/소 & 계층 연결 정보)
  const taxonomy = recoData?.debug?.taxonomy || {};
  const lOptions = taxonomy.L || [];
  const MByL = taxonomy.MByL || {};
  const SByM = taxonomy.SByM || {};

  // 선택된 대분류에 맞는 중분류만 노출
  const mOptions =
    selectedL && MByL[selectedL] ? MByL[selectedL] : [];

  // 선택된 대/중분류에 맞게 top 필터링 (소분류 이름 → 중/대분류 추론)
  function belongsToSelectedBranch(sName) {
    // taxonomy 정보가 거의 없으면 필터링 안 함
    const hasHierarchy =
      Object.keys(MByL).length > 0 && Object.keys(SByM).length > 0;
    if (!hasHierarchy) {
      // 선택이 없으면 전부 노출, 선택이 있으면 일단 다 보여주도록(데이터 부족 케이스)
      return true;
    }

    // 소분류가 어떤 중분류(M)에 속하는지 찾기
    let mName = null;
    for (const [m, sList] of Object.entries(SByM)) {
      if (Array.isArray(sList) && sList.includes(sName)) {
        mName = m;
        break;
      }
    }

    // 중분류 못 찾은 경우: 계층 정보 부족 → 선택 없으면 포함, 선택 있으면 제외
    if (!mName) {
      if (!selectedL && !selectedM) return true;
      return false;
    }

    // 이 중분류가 어떤 대분류(L)에 속하는지 찾기
    let lName = null;
    for (const [l, mList] of Object.entries(MByL)) {
      if (Array.isArray(mList) && mList.includes(mName)) {
        lName = l;
        break;
      }
    }

    if (selectedL && lName !== selectedL) return false;
    if (selectedM && mName !== selectedM) return false;
    return true;
  }

  // 🔹 필터링된 추천 리스트
  const filteredTop = top.filter((item) => {
    const sName = item.category; // 백엔드에서 소분류 이름으로 옴
    return belongsToSelectedBranch(sName);
  });

  // 분리: 일반/허가
  const { openableList, licensedList } = partitionCategories(filteredTop);

  // 각 5개로 고정 (부족하면 서로에서 백필)
  const openable5 = fillToFive(openableList, licensedList);
  const licensed5 = fillToFive(licensedList, openableList);

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

  // 대분류 선택 핸들러
  const handleSelectL = (l) => {
    const next = selectedL === l ? null : l;
    setSelectedL(next);
    setSelectedM(null); // 대분류 바꾸면 중분류 리셋
  };

  // 중분류 선택 핸들러
  const handleSelectM = (m) => {
    const next = selectedM === m ? null : m;
    setSelectedM(next);
  };

  /** 🔹 선택된 대/중분류 → 프랜차이즈 목록 연동 */
  useEffect(() => {
    // 아무것도 선택 안 했으면 리스트/에러 초기화
    if (!selectedL && !selectedM) {
      setBrandList([]);
      setBrandErr(null);
      return;
    }

    const fetchBrands = async () => {
      try {
        setBrandLoading(true);
        setBrandErr(null);

        const qs = new URLSearchParams();
        if (selectedL) qs.append("l", selectedL); // 대분류
        if (selectedM) qs.append("m", selectedM); // 중분류
        qs.append("year", "2023"); // 일단 2023 고정 (필요하면 최신 연도로 수정)

        const res = await fetch(
          `${RECO_API_BASE}/brands/by-category?${qs.toString()}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        setBrandList(json.brands || []);
      } catch (e) {
        console.log("브랜드 조회 실패:", e);
        setBrandErr("프랜차이즈 정보를 불러오지 못했어요.");
        setBrandList([]);
      } finally {
        setBrandLoading(false);
      }
    };

    fetchBrands();
  }, [selectedL, selectedM]);

  return (
    <View style={{ flex: 1 }}>
      {/* 지도 */}
      <MapView style={{ flex: 1 }} region={region}>
        {coords && (
          <Marker
            coordinate={{
              latitude: coords.latitude,
              longitude: coords.longitude,
            }}
          />
        )}
      </MapView>

      {/* 결과 패널 */}
      {(loading || errMsg || whyLine || filteredTop.length > 0) && (
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
            <Text
              style={{ color: "#B91C1C", marginBottom: 6, fontSize: 12 }}
            >
              {errMsg}
            </Text>
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
                  결제강도(log) {fmtNum(d.commerce?.pay_cnt_log)} · 상권레벨{" "}
                  {fmtNum(d.commerce?.cmrcl_level)}
                </Text>
              )}

              {/* 업종 분포 */}
              <Text style={styles.sectionTitle}>업종 분포</Text>
              <Text style={styles.item}>
                총 {d.poi?.total ?? 0}개 · 다양도(entropy){" "}
                {fmtNum(d.poi?.entropy)}
              </Text>

              {/* 표본 적으면 안내 */}
              {(d.poi?.total ?? 0) < 5 ? (
                <Text style={styles.item}>
                  표본이 적어 상위/하위 업종 비교는 생략했어요.
                </Text>
              ) : (
                <>
                  {/* 많은 업종 Top 3 */}
                  {Array.isArray(d.poi?.topMost) &&
                    d.poi.topMost.length > 0 && (
                      <>
                        <Text style={styles.subTitle}>많은 업종 Top 3</Text>
                        {d.poi.topMost.slice(0, 3).map((x) => (
                          <Text
                            key={`top-${x.category}`}
                            style={styles.item}
                          >
                            • {x.category} {fmtPct(x.share)} ({x.count})
                          </Text>
                        ))}
                      </>
                    )}

                  {/* 적은 업종 Top 3 (중복 제거) */}
                  {Array.isArray(d.poi?.leastCommon) &&
                    d.poi.leastCommon.length > 0 && (
                      <>
                        <Text style={styles.subTitle}>적은 업종 Top 3</Text>
                        {d.poi.leastCommon
                          .filter(
                            (x) =>
                              !d.poi.topMost?.some?.(
                                (y) => y.category === x.category
                              )
                          )
                          .slice(0, 3)
                          .map((x) => (
                            <Text
                              key={`low-${x.category}`}
                              style={styles.item}
                            >
                              • {x.category} {fmtPct(x.share)} ({x.count})
                            </Text>
                          ))}
                      </>
                    )}
                </>
              )}
            </View>
          ) : null}

          {/* 🔹 분류 선택 UI (대분류 / 중분류) */}
          {!loading && !errMsg && taxonomy && (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.sectionTitle}>업종 필터</Text>

              {/* 대분류 선택 */}
              <Text style={styles.subTitle}>대분류 선택</Text>
              <View style={styles.chipRow}>
                {lOptions.map((l) => (
                  <Chip
                    key={l}
                    label={l}
                    active={selectedL === l}
                    onPress={() => handleSelectL(l)}
                  />
                ))}
                {lOptions.length === 0 && (
                  <Text style={styles.dim}>대분류 정보가 부족합니다.</Text>
                )}
              </View>

              {/* 중분류 선택: 대분류 선택 + 데이터 있을 때만 칩 */}
              <Text style={styles.subTitle}>중분류 선택</Text>
              {mOptions.length > 0 ? (
                <View style={styles.chipRow}>
                  {mOptions.map((m) => (
                    <Chip
                      key={m}
                      label={m}
                      active={selectedM === m}
                      onPress={() => handleSelectM(m)}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.dim}>
                  이 상권에서는 중분류 데이터가 거의 없어 대분류만 사용할 수 있어요.
                </Text>
              )}

              <Text style={styles.dim}>
                ※ 대/중분류를 바꾸면, 해당 계층에 속한 소분류만 추천 리스트에 보여줘요.
              </Text>

              {/* 🔹 소분류 (프랜차이즈) 리스트 */}
              <Text style={styles.subTitle}>소분류 (프랜차이즈)</Text>
              {brandLoading && (
                <Text style={styles.dim}>프랜차이즈 불러오는 중…</Text>
              )}
              {!brandLoading && brandErr && (
                <Text style={{ color: "#B91C1C", fontSize: 12 }}>
                  {brandErr}
                </Text>
              )}
              {!brandLoading && !brandErr && (
                brandList.length > 0 ? (
                  <View style={{ marginTop: 4 }}>
                    {brandList.slice(0, 10).map((b) => (
                      <Text key={b.brandNm} style={styles.item}>
                        • {b.brandNm}
                        {b.frcsCnt != null && ` (${b.frcsCnt}개 점포)`}
                        {b.avrgSlsAmt != null &&
                          ` · 평균매출 ${Number(
                            b.avrgSlsAmt
                          ).toLocaleString()}원`}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.dim}>
                    선택한 업종에 연동된 프랜차이즈 정보가 없어요.
                  </Text>
                )
              )}
            </View>
          )}

          {/* 탭 스위치 */}
          {!loading && !errMsg && filteredTop.length > 0 && (
            <View style={styles.tabs}>
              <TabButton
                label="일반 창업 가능"
                active={activeTab === "openable"}
                onPress={() => setActiveTab("openable")}
              />
              <TabButton
                label="전문/허가 필요"
                active={activeTab === "licensed"}
                onPress={() => setActiveTab("licensed")}
              />
            </View>
          )}

          {/* 추천 업종 리스트 (탭에 따라) */}
          {!loading && !errMsg && filteredTop.length > 0 ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.recoTitle}>
                {activeTab === "openable"
                  ? "일반 창업 가능 (5개)"
                  : "전문/허가 필요 (5개)"}
              </Text>
              {renderCategoryList(
                activeTab === "openable" ? openable5 : licensed5
              )}
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
        <Button
          title={loading ? "검색 중…" : "검색"}
          onPress={handleSearch}
          disabled={loading}
        />
      </View>
    </View>
  );
};

/** 리스트 렌더러 (한 파일 내 간단 버전) */
function renderCategoryList(items) {
  return items.map((r) => {
    const meta = getMeta(r.category);
    return (
      <Text key={r.category} style={styles.recoItem}>
        • {r.category}
        <Text style={styles.recoScore}>
          {" "}
          {typeof r.score === "number" ? r.score.toFixed(3) : String(r.score)}
        </Text>
        {!meta.openable && (
          <Text style={styles.licenseBadge}>  허가/자격 필요</Text>
        )}
        {r._fromOtherGroup && (
          <Text style={styles.altBadge}>  대체추천</Text>
        )}
      </Text>
    );
  });
}

/** 카테고리 분리 */
function partitionCategories(items = []) {
  const openableList = [];
  const licensedList = [];
  for (const x of items) {
    const m = getMeta(x.category);
    if (m.openable) openableList.push(x);
    else licensedList.push(x);
  }
  return { openableList, licensedList };
}

/** 5개로 고정: 부족하면 다른 그룹에서 백필(중복 방지 & 표시용 플래그) */
function fillToFive(primary, secondary) {
  const want = 5;
  const base = primary.slice(0, want);
  if (base.length >= want) return base;

  const need = want - base.length;
  const extras = secondary
    .filter((x) => !base.find((b) => b.category === x.category))
    .slice(0, need)
    .map((x) => ({ ...x, _fromOtherGroup: true }));

  return base.concat(extras);
}

/** 탭 버튼 (간단 스타일) */
function TabButton({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabBtn, active && styles.tabBtnActive]}
    >
      <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** Chip 컴포넌트 (분류 선택용) */
function Chip({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

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
      rate_20s = 0,
      rate_30s = 0,
      female_rate = 0,
      cmrcl_level = 0,
      pay_cnt_log = 0,
      poi_entropy = 0,
    } = fv;

    const reasons = [];
    if (rate_20s >= 0.22) reasons.push("20대 비중 높음");
    if (rate_30s >= 0.2) reasons.push("30대 비중 높음");
    if (female_rate >= 0.5) reasons.push("여성 비중 높음");

    const payHigh = pay_cnt_log >= 6.0;
    const payMid = pay_cnt_log >= 5.0;
    const lvlHigh = cmrcl_level >= 0.6;
    const lvlMid = cmrcl_level >= 0.3;
    if (payHigh || lvlHigh) reasons.push("결제활동 상위권");
    else if (payMid || lvlMid) reasons.push("상권 활력 보통");

    if (poi_entropy >= 1.5) reasons.push("업종 다양도 높음");

    const total = Object.values(byCate).reduce((a, b) => a + b, 0) || 1;
    const same = byCate[topCategory] || 0;
    const share = same / total;
    if (share >= 0.5) reasons.push("동일 업종 과밀");
    else if (share <= 0.2 && total > 3) reasons.push("동일 업종 드묾");

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
      rate_20s = 0,
      rate_30s = 0,
      female_rate = 0,
      cmrcl_level = 0,
      pay_cnt_log = 0,
      poi_entropy = 0,
      poi_total = 0,
    } = fv;

    const total = Object.values(byCate).reduce((a, b) => a + b, 0) || 1;
    const same = topCategory ? byCate[topCategory] || 0 : 0;
    const share = same / total;

    const entries = Object.entries(byCate).sort((a, b) => b[1] - a[1]);
    const topMost = entries
      .slice(0, 5)
      .map(([k, v]) => ({ category: k, count: v, share: v / total }));
    const leastCommon = entries
      .slice(-5)
      .map(([k, v]) => ({ category: k, count: v, share: v / total }));

    const TH = {
      RATE20S_HIGH: 0.22,
      RATE30S_HIGH: 0.2,
      FEMALE_RATE_HIGH: 0.5,
      PAY_LOG_HIGH: 6.0,
      PAY_LOG_MID: 5.0,
      CMR_LEVEL_HIGH: 0.6,
      CMR_LEVEL_MID: 0.3,
      ENTROPY_HIGH: 1.5,
      COMP_OVER: 0.5,
      COMP_UNDER: 0.2,
      COMP_MIN_TOTAL: 3,
    };

    const pctLocal = (x) => `${(x * 100).toFixed(1)}%`;

    return {
      demographics: {
        female: { value: female_rate, label: `여성 ${pctLocal(female_rate)}` },
        age20s: { value: rate_20s, label: `20대 ${pctLocal(rate_20s)}` },
        age30s: { value: rate_30s, label: `30대 ${pctLocal(rate_30s)}` },
        flags: {
          femaleHigh: female_rate >= TH.FEMALE_RATE_HIGH,
          age20sHigh: rate_20s >= TH.RATE20S_HIGH,
          age30sHigh: rate_30s >= TH.RATE30S_HIGH,
        },
      },
      commerce: {
        cmrcl_level,
        pay_cnt_log,
        notes:
          pay_cnt_log === 0 && cmrcl_level === 0
            ? "상권(결제) 데이터 없음/부족"
            : undefined,
        flags: {
          payHigh: pay_cnt_log >= TH.PAY_LOG_HIGH,
          payMid: pay_cnt_log >= TH.PAY_LOG_MID,
          lvlHigh: cmrcl_level >= TH.CMR_LEVEL_HIGH,
          lvlMid: cmrcl_level >= TH.CMR_LEVEL_MID,
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
              : share <= TH.COMP_UNDER && total > TH.COMP_MIN_TOTAL
              ? "동일 업종 드묾"
              : "보통",
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
  tabs: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    borderRadius: 10,
    padding: 4,
    marginTop: 10,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: "center",
  },
  tabBtnActive: { backgroundColor: "white", elevation: 2 },
  tabTxt: { fontSize: 12, color: "#6B7280", fontWeight: "600" },
  tabTxtActive: { color: "#111827" },
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
  licenseBadge: {
    fontSize: 10,
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  altBadge: {
    fontSize: 10,
    color: "#2563EB",
    backgroundColor: "#DBEAFE",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    marginLeft: 4,
  },
  dim: { fontSize: 12, color: "#6B7280" },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
    marginBottom: 4,
  },
  chip: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    marginRight: 6,
    marginBottom: 6,
  },
  chipActive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  chipText: {
    fontSize: 11,
    color: "#4B5563",
  },
  chipTextActive: {
    color: "#F9FAFB",
  },
});

export default MapScreen;
