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
  ScrollView,
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
const RECO_API_BASE = "http://localhost:3000/api/v1";

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
  },
  한식: { openable: true, needsLicense: false, franchiseable: true },

  // 전문/허가 필요
  보건의료: { openable: false, needsLicense: true, franchiseable: false },
  교육: { openable: false, needsLicense: true, franchiseable: true },
  부동산: { openable: false, needsLicense: true, franchiseable: false },
  숙박: { openable: false, needsLicense: true, franchiseable: true },

  // 기타
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

  // UX
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  // 탭(일반/허가) 스위치
  const [activeTab, setActiveTab] = useState("openable"); // "openable" | "licensed"

  // 사용자 분류 선택 (대/중분류)
  const [selectedL, setSelectedL] = useState(null); // 대분류
  const [selectedM, setSelectedM] = useState(null); // 중분류

  // 대분류 선호도 (관심있음 / 없음)
  const [interestedL, setInterestedL] = useState([]); // string[]
  const [blockedL, setBlockedL] = useState([]); // string[]

  // 검색 / 고급 필터
  const [searchQuery, setSearchQuery] = useState("");
  const [densityFilter, setDensityFilter] = useState("all"); // all | many | few
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);

  // 프랜차이즈
  const [brandList, setBrandList] = useState([]);
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandErr, setBrandErr] = useState(null);

  // 화면 단계: idle | summary | category | result
  const [step, setStep] = useState("idle");
  const [selectedCategory, setSelectedCategory] = useState(null);

  const handleSearch = async () => {
    if (!address.trim() || loading) return;
    setErrMsg(null);
    setLoading(true);
    setStep("idle");
    setSelectedCategory(null);
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
      const admmCd = await getAdmmCdByDong(fullDongName);
      console.log("변환된 admmCd:", admmCd);

      // (선택) 인구 API 조회 – 백엔드가 자체 조회하므로 없어도 동작
      if (admmCd) {
        const parts = (fullDongName || "").split(" ").filter(Boolean);
        const dongName = parts.length ? parts[parts.length - 1] : undefined;
        const population = await getPopulationByDong(admmCd, dongName);
        console.log("인구 데이터(프론트):", population);
      }

      // 4) 추천 API 호출
      const kakaoAddrObj = {
        x: String(result.longitude),
        y: String(result.latitude),
        b_code: undefined,
        region_2depth_name: pickGuFromFull(fullDongName),
      };

      let payload = buildRecommendPayload({
        kakaoAddr: kakaoAddrObj,
        storesResp: stores,
        areaCd: undefined,
        topK: 10,
      });

      let targetCate = null;
      if (selectedM) {
        targetCate = { level: "M", name: selectedM };
      } else if (selectedL) {
        targetCate = { level: "L", name: selectedL };
      }
      if (targetCate) {
        payload = { ...payload, targetCate };
      }

      const rec = await fetchRecommendations(payload);
      console.log("추천 결과 원본:", JSON.stringify(rec, null, 2));

      setRecoData(rec);
      setStep("summary");
    } catch (e) {
      console.warn("추천 호출 실패:", e?.message ?? e);
      setErrMsg(e?.message || "요청 중 오류가 발생했습니다.");
      setRecoData(null);
      setStep("idle");
    } finally {
      setLoading(false);
    }
  };

  // Why 라인/상세
  const whyLine = recoData?.why?.line ?? buildWhyFallback(recoData) ?? null;
  const d = recoData?.why?.details ?? buildDetailsFallback(recoData) ?? null;

  // Top-K (항상 소분류 기준)
  const top = Array.isArray(recoData?.topCategories)
    ? recoData.topCategories
    : [];

  // taxonomy
  const taxonomy = recoData?.debug?.taxonomy || {};
  const lOptions = taxonomy.L || [];
  const MByL = taxonomy.MByL || {};
  const SByM = taxonomy.SByM || {};

  // 선택된 대분류에 맞는 중분류
  const mOptions =
    selectedL && MByL[selectedL] ? MByL[selectedL] : [];

  // 소분류 -> 중분류 찾기
  function findMByS(sName) {
    for (const [m, sList] of Object.entries(SByM)) {
      if (Array.isArray(sList) && sList.includes(sName)) {
        return m;
      }
    }
    return null;
  }

  // 중분류 -> 대분류 찾기
  function findLByM(mName) {
    for (const [l, mList] of Object.entries(MByL)) {
      if (Array.isArray(mList) && mList.includes(mName)) {
        return l;
      }
    }
    return null;
  }

  // 대분류 선호도 필터
  function allowedByInterest(lName) {
    if (!lName) return true;
    if (blockedL.includes(lName)) return false;
    if (interestedL.length > 0 && !interestedL.includes(lName)) return false;
    return true;
  }

  // 대분류 관심/비관심 토글 (길게 누르기)
  const handleToggleInterestL = (l) => {
    const isLiked = interestedL.includes(l);
    const isBlocked = blockedL.includes(l);

    if (!isLiked && !isBlocked) {
      // 기본 -> 관심있음
      setInterestedL([...interestedL, l]);
    } else if (isLiked) {
      // 관심있음 -> 관심없음
      setInterestedL(interestedL.filter((x) => x !== l));
      setBlockedL([...blockedL, l]);
    } else if (isBlocked) {
      // 관심없음 -> 기본
      setBlockedL(blockedL.filter((x) => x !== l));
    }
  };

  // 대분류/중분류 선택 핸들러
  const handleSelectL = (l) => {
    const next = selectedL === l ? null : l;
    setSelectedL(next);
    setSelectedM(null);
  };
  const handleSelectM = (m) => {
    const next = selectedM === m ? null : m;
    setSelectedM(next);
  };

  // 소분류가 선택한 L/M 아래에 있는지 체크
  function belongsToSelectedBranch(sName) {
    const hasHierarchy =
      Object.keys(MByL).length > 0 && Object.keys(SByM).length > 0;
    if (!hasHierarchy) {
      return true;
    }

    const mName = findMByS(sName);
    if (!mName) {
      if (!selectedL && !selectedM) return true;
      return false;
    }

    const lName = findLByM(mName);

    if (selectedL && lName && lName !== selectedL) return false;
    if (selectedM && mName !== selectedM) return false;

    return true;
  }

  // 업종 분포 상위/하위 (details에서 가져옴)
  const manyCateSet = React.useMemo(
    () => new Set(d?.poi?.topMost?.map((x) => x.category) || []),
    [d]
  );
  const fewCateSet = React.useMemo(
    () => new Set(d?.poi?.leastCommon?.map((x) => x.category) || []),
    [d]
  );

  // 🔹 소분류 추천 필터
  const filteredTop = top.filter((item) => {
    const sName = item.category;

    // ① 대분류/중분류 드릴다운 가지 안에 속하는지
    if (!belongsToSelectedBranch(sName)) {
      return false;
    }

    // ② 대분류 선호도(관심있음/없음) 필터
    const mName = findMByS(sName);
    const lName = mName ? findLByM(mName) : null;
    if (lName && !allowedByInterest(lName)) {
      return false;
    }

    // ③ 업종 분포 필터 (많은 업종 / 적은 업종)
    if (densityFilter === "many" && !manyCateSet.has(sName)) {
      return false;
    }
    if (densityFilter === "few" && !fewCateSet.has(sName)) {
      return false;
    }

    // ④ 검색 필터 (소분류명 기준)
    if (searchQuery.trim()) {
      const q = searchQuery.trim();
      if (!sName.includes(q)) {
        return false;
      }
    }

    return true;
  });

  // 🔹 필터 결과가 비면 전체 top으로 fallback
  const effectiveTop = filteredTop.length > 0 ? filteredTop : top;

  // 🔹 일반/허가 분리 + 5개로 고정
  const { openableList, licensedList } = partitionCategories(effectiveTop);
  const openable5 = fillToFive(openableList, licensedList);
  const licensed5 = fillToFive(licensedList, openableList);

  // 🔹 중분류 추천 (선택된 대분류 안에서, 소분류 점수 합산)
  const midScores = {};
  for (const item of top) {
    const sName = item.category;
    const score = typeof item.score === "number" ? item.score : 0;

    const mName = findMByS(sName);
    if (!mName) continue;

    const lName = findLByM(mName);
    if (lName && !allowedByInterest(lName)) continue;

    // 선택된 대분류가 있으면, 그 L 아래에 있는 M만 인정
    if (selectedL && lName && lName !== selectedL) continue;

    midScores[mName] = (midScores[mName] || 0) + score;
  }

  const midList = Object.entries(midScores)
    .map(([m, score]) => ({ m, score }))
    .sort((a, b) => b.score - a.score);
  const midTop5 = midList.slice(0, 5);

  const renderMidList = (items = []) =>
    items.map((it) => (
      <TouchableOpacity
        key={it.m}
        onPress={() => {
          setSelectedM(it.m);
        }}
      >
        <Text style={styles.recoItem}>
          • {it.m}
          <Text style={styles.recoScore}>
            {" "}
            {typeof it.score === "number"
              ? it.score.toFixed(3)
              : String(it.score)}
          </Text>
        </Text>
      </TouchableOpacity>
    ));

  /** 🔹 프랜차이즈 목록: L/M에 맞는 것만 추천에 사용 */
  useEffect(() => {
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
        if (selectedL) qs.append("l", selectedL);
        if (selectedM) qs.append("m", selectedM);
        qs.append("year", "2023");

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

  // 🔹 선택한 L/M + taxonomy 기준으로 프랜차이즈 필터
  const filteredBrandList = brandList.filter((b) => {
    // 1) 선택한 대분류 기준으로 taxonomy 가지 안에 있는 프랜차이즈만 허용
    if (selectedL) {
      const mListForSelectedL = MByL[selectedL];

      if (Array.isArray(mListForSelectedL) && b.indutyMlsfcNm) {
        if (!mListForSelectedL.includes(b.indutyMlsfcNm)) {
          return false;
        }
      } else {
        if (b.indutyLclasNm !== selectedL) return false;
      }
    }

    // 2) 선택한 중분류와 다른 프랜차이즈는 제외
    if (selectedM && b.indutyMlsfcNm !== selectedM) return false;

    // 3) 대분류 선호도(관심/비관심) 필터
    const lName = b.indutyLclasNm;
    if (lName && !allowedByInterest(lName)) return false;

    return true;
  });

  const shownBrandList =
    selectedL || selectedM ? filteredBrandList : brandList;

  // 검색 적용된 프랜차이즈 리스트
  const searchedBrandList = React.useMemo(() => {
    if (!searchQuery.trim()) return shownBrandList;
    const q = searchQuery.trim();
    return shownBrandList.filter(
      (b) =>
        b.brandNm?.includes(q) ||
        b.indutyMlsfcNm?.includes(q) ||
        b.indutyLclasNm?.includes(q)
    );
  }, [shownBrandList, searchQuery]);

  const hasReco = !!recoData;

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
      {(loading || errMsg || hasReco) && (
        <View style={styles.recoContainer}>
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={true}
          >
            {/* 로딩 */}
            {loading && (
              <View style={styles.rowCenter}>
                <ActivityIndicator />
                <Text style={{ marginLeft: 8, fontSize: 12 }}>
                  분석 중…
                </Text>
              </View>
            )}

            {/* 에러 */}
            {!loading && errMsg && (
              <Text
                style={{
                  color: "#B91C1C",
                  marginBottom: 6,
                  fontSize: 12,
                }}
              >
                {errMsg}
              </Text>
            )}

            {/* 정상 데이터 */}
            {!loading && !errMsg && hasReco && (
              <>
                {/* 1) 요약 단계 */}
                {step === "summary" && (
                  <View>
                    {whyLine && (
                      <View style={styles.whyBadge}>
                        <Text style={styles.whyText}>{whyLine}</Text>
                      </View>
                    )}

                    {d && (
                      <>
                        <Text style={styles.sectionTitle}>인구·연령</Text>
                        <Text style={styles.item}>
                          {d.demographics?.female?.label}
                          {" · "}
                          {d.demographics?.age20s?.label}
                          {" · "}
                          {d.demographics?.age30s?.label}
                        </Text>

                        <Text style={styles.sectionTitle}>상권/결제</Text>
                        <Text style={styles.item}>
                          {d.commerce?.notes ||
                            `결제강도(log) ${fmtNum(
                              d.commerce?.pay_cnt_log
                            )} · 상권레벨 ${fmtNum(
                              d.commerce?.cmrcl_level
                            )}`}
                        </Text>

                        <Text style={styles.sectionTitle}>업종 분포</Text>
                        <Text style={styles.item}>
                          총 {d.poi?.total ?? 0}개 · 다양도(entropy){" "}
                          {fmtNum(d.poi?.entropy)}
                        </Text>
                      </>
                    )}

                    <View style={{ marginTop: 10 }}>
                      <TouchableOpacity
                        style={[styles.tabBtn, styles.tabBtnActive]}
                        onPress={() => setStep("category")}
                      >
                        <Text style={styles.tabTxtActive}>
                          추천 업종 보기
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* 2) 업종 선택 단계 */}
                {step === "category" && (
                  <View>
                    {whyLine && (
                      <View style={styles.whyBadge}>
                        <Text style={styles.whyText}>{whyLine}</Text>
                      </View>
                    )}

                    {/* 검색 + breadcrumb + 고급필터 */}
                    <View style={{ marginTop: 10 }}>
                      <Text style={styles.sectionTitle}>
                        어떤 업종을 생각 중이신가요?
                      </Text>
                      <TextInput
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder="업종이나 프랜차이즈 이름을 직접 검색해보세요"
                        style={styles.searchInput}
                      />

                      {/* 단계 표시 (Breadcrumb) */}
                      <Text style={styles.breadcrumb}>
                        {selectedL || selectedM
                          ? `${selectedL ?? "대분류 미선택"}${
                              selectedM ? " > " + selectedM : ""
                            }`
                          : "대분류 > 중분류 > 프랜차이즈(선택)"}
                      </Text>

                      {/* 고급 필터 토글 */}
                      <TouchableOpacity
                        style={styles.advancedToggle}
                        onPress={() =>
                          setShowAdvancedFilter((prev) => !prev)
                        }
                      >
                        <Text style={styles.advancedToggleText}>
                          {showAdvancedFilter
                            ? "고급 필터 접기"
                            : "고급 필터 열기"}
                        </Text>
                      </TouchableOpacity>

                      {showAdvancedFilter && (
                        <View style={styles.advancedBox}>
                          <Text style={styles.subTitle}>
                            수요/매출 관련
                          </Text>
                          <View className={styles.chipRow}>
                            {/* TODO: 성장률 데이터 연결 시 로직 적용 */}
                            <Chip
                              label="성장률 높은 업종만"
                              active={false}
                              onPress={() => {}}
                            />
                          </View>

                          <Text style={styles.subTitle}>
                            경쟁도 관련
                          </Text>
                          <View style={styles.chipRow}>
                            <Chip
                              label="많이 존재하는 업종만"
                              active={densityFilter === "many"}
                              onPress={() =>
                                setDensityFilter(
                                  densityFilter === "many"
                                    ? "all"
                                    : "many"
                                )
                              }
                            />
                            <Chip
                              label="거의 없는 업종만"
                              active={densityFilter === "few"}
                              onPress={() =>
                                setDensityFilter(
                                  densityFilter === "few"
                                    ? "all"
                                    : "few"
                                )
                              }
                            />
                          </View>

                          <Text style={styles.subTitle}>
                            형태 관련
                          </Text>
                          <View style={styles.chipRow}>
                            {/* TODO: 프랜차이즈/비프랜차이즈 구분 데이터 연결 필요 */}
                            <Chip
                              label="프랜차이즈만"
                              active={false}
                              onPress={() => {}}
                            />
                            <Chip
                              label="비프랜차이즈만"
                              active={false}
                              onPress={() => {}}
                            />
                          </View>
                        </View>
                      )}
                    </View>

                    <View style={{ marginTop: 10 }}>
                      <Text style={styles.sectionTitle}>업종 필터</Text>

                      {/* 대분류 */}
                      <Text style={styles.subTitle}>대분류 선택</Text>
                      <View style={styles.chipRow}>
                        {lOptions.map((l) => (
                          <Chip
                            key={l}
                            label={l}
                            active={selectedL === l}
                            status={
                              blockedL.includes(l)
                                ? "blocked"
                                : interestedL.includes(l)
                                ? "liked"
                                : "normal"
                            }
                            onPress={() => handleSelectL(l)}
                            onLongPress={() => handleToggleInterestL(l)}
                          />
                        ))}
                        {lOptions.length === 0 && (
                          <Text style={styles.dim}>
                            대분류 정보가 부족합니다.
                          </Text>
                        )}
                      </View>
                      <Text style={styles.dim}>
                        ※ 대분류 칩을 길게 누르면 "관심있음 → 관심없음 → 해제"
                        로 바뀌고, 관심없는 대분류는 추천에서 제외돼요.
                      </Text>

                      {/* 중분류 */}
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
                          이 상권에서는 중분류 데이터가 거의 없어
                          대분류만 사용할 수 있어요.
                        </Text>
                      )}

                      <Text style={styles.dim}>
                        ※ 대/중분류를 바꾸면, 해당 계층에 속한 소분류만
                        추천 리스트에 보여줘요.
                      </Text>

                      {/* 프랜차이즈 추천 */}
                      <Text style={styles.subTitle}>
                        프랜차이즈 추천
                        {searchedBrandList.length > 0 &&
                          ` (TOP ${Math.min(
                            10,
                            searchedBrandList.length
                          )})`}
                      </Text>
                      {brandLoading && (
                        <Text style={styles.dim}>
                          프랜차이즈 불러오는 중…
                        </Text>
                      )}
                      {!brandLoading && brandErr && (
                        <Text
                          style={{ color: "#B91C1C", fontSize: 12 }}
                        >
                          {brandErr}
                        </Text>
                      )}
                      {!brandLoading && !brandErr && (
                        searchedBrandList.length > 0 ? (
                          <View style={{ marginTop: 4 }}>
                            {searchedBrandList
                              .slice(0, 10)
                              .map((b, idx) => (
                                <Text
                                  key={`${b.brandNm}-${idx}`}
                                  style={styles.item}
                                >
                                  <Text style={styles.brandRank}>
                                    {idx + 1}.
                                  </Text>{" "}
                                  <Text style={styles.brandName}>
                                    {b.brandNm}
                                  </Text>
                                  {b.frcsCnt != null && (
                                    <Text style={styles.brandMeta}>
                                      {"  · 가맹점 "}
                                      {b.frcsCnt}개
                                    </Text>
                                  )}
                                  {b.avrgSlsAmt != null && (
                                    <Text style={styles.brandMeta}>
                                      {"  · 평균 매출 "}
                                      {Number(
                                        b.avrgSlsAmt
                                      ).toLocaleString()}
                                      원
                                    </Text>
                                  )}
                                </Text>
                              ))}
                          </View>
                        ) : (
                          <Text style={styles.dim}>
                            {selectedL || selectedM
                              ? "선택한 대/중분류 및 검색 조건에 맞는 프랜차이즈가 없어요."
                              : "프랜차이즈 정보가 없어요."}
                          </Text>
                        )
                      )}
                    </View>

                    {/* 탭 스위치 */}
                    {effectiveTop.length > 0 && (
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

                    {/* 추천 리스트 (중분류 + 소분류) */}
                    {effectiveTop.length > 0 && (
                      <>
                        <View style={styles.divider} />

                        {/* 중분류 TOP 5 */}
                        {selectedL && midTop5.length > 0 && (
                          <>
                            <Text style={styles.recoTitle}>
                              선택한 대분류 안에서 중분류 추천 (TOP 5)
                            </Text>
                            {renderMidList(midTop5)}
                            <View style={styles.divider} />
                          </>
                        )}

                        {/* 소분류 TOP 5 */}
                        <Text style={styles.recoTitle}>
                          {activeTab === "openable"
                            ? "소분류 추천 - 일반 창업 가능 (5개)"
                            : "소분류 추천 - 전문/허가 필요 (5개)"}
                        </Text>

                        {(activeTab === "openable"
                          ? openable5
                          : licensed5
                        ).map((r) => {
                          const meta = getMeta(r.category);
                          return (
                            <TouchableOpacity
                              key={r.category}
                              onPress={() => {
                                setSelectedCategory(r);
                                setStep("result");
                              }}
                            >
                              <Text style={styles.recoItem}>
                                • {r.category}
                                <Text style={styles.recoScore}>
                                  {" "}
                                  {typeof r.score === "number"
                                    ? r.score.toFixed(3)
                                    : String(r.score)}
                                </Text>
                                {!meta.openable && (
                                  <Text style={styles.licenseBadge}>
                                    {" "}
                                    허가/자격 필요
                                  </Text>
                                )}
                                {r._fromOtherGroup && (
                                  <Text style={styles.altBadge}>
                                    {" "}
                                    대체추천
                                  </Text>
                                )}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}

                        {filteredTop.length === 0 &&
                          (selectedL ||
                            selectedM ||
                            searchQuery.trim() ||
                            densityFilter !== "all") && (
                            <Text
                              style={[styles.dim, { marginTop: 4 }]}
                            >
                              선택한 대/중분류나 필터, 검색 조건에 딱 맞는
                              업종은 없어서, 전체 추천 기준으로 보여드리고
                              있어요.
                            </Text>
                          )}
                      </>
                    )}
                  </View>
                )}

                {/* 3) 결과 단계 */}
                {step === "result" && selectedCategory && (
                  <View>
                    <Text style={styles.sectionTitle}>
                      선택한 업종
                    </Text>
                    <Text style={styles.recoItem}>
                      {selectedCategory.category} · 점수{" "}
                      {typeof selectedCategory.score === "number"
                        ? selectedCategory.score.toFixed(3)
                        : String(selectedCategory.score)}
                    </Text>

                    {whyLine && (
                      <View
                        style={[
                          styles.whyBadge,
                          { marginTop: 8 },
                        ]}
                      >
                        <Text style={styles.whyText}>
                          {whyLine}
                        </Text>
                      </View>
                    )}

                    {d && (
                      <>
                        <Text style={styles.sectionTitle}>
                          이 상권과 이 업종
                        </Text>
                        <Text style={styles.item}>
                          • {d.demographics?.female?.label},{" "}
                          {d.demographics?.age20s?.label},{" "}
                          {d.demographics?.age30s?.label}
                        </Text>
                        <Text style={styles.item}>
                          • 상권/결제:{" "}
                          {d.commerce?.notes ||
                            `결제강도(log) ${fmtNum(
                              d.commerce?.pay_cnt_log
                            )} · 상권레벨 ${fmtNum(
                              d.commerce?.cmrcl_level
                            )}`}
                        </Text>
                        {d.poi && (
                          <Text style={styles.item}>
                            • 업종 수 {d.poi.total ?? 0}개 · 다양도{" "}
                            {fmtNum(d.poi.entropy)}
                          </Text>
                        )}
                      </>
                    )}

                    <View
                      style={{
                        marginTop: 10,
                        flexDirection: "row",
                        gap: 8,
                      }}
                    >
                      <TouchableOpacity
                        style={[styles.tabBtn, { flex: 1 }]}
                        onPress={() => setStep("category")}
                      >
                        <Text style={styles.tabTxt}>
                          다른 업종 보기
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.tabBtn,
                          styles.tabBtnActive,
                          { flex: 1 },
                        ]}
                        onPress={() => setStep("summary")}
                      >
                        <Text style={styles.tabTxtActive}>
                          상권 요약 보기
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      )}

      {/* 주소 입력 */}
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

/** 5개로 고정: 부족하면 다른 그룹에서 백필 */
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

/** 탭 버튼 */
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

/** Chip 컴포넌트 */
function Chip({ label, active, onPress, onLongPress, status }) {
  const isLiked = status === "liked";
  const isBlocked = status === "blocked";

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.chip,
        active && styles.chipActive,
        isLiked && !active && styles.chipLiked,
        isBlocked && styles.chipBlocked,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          (active || isLiked) && styles.chipTextActive,
          isBlocked && styles.chipTextBlocked,
        ]}
      >
        {label}
        {isLiked && " ★"}
        {isBlocked && " ×"}
      </Text>
    </TouchableOpacity>
  );
}

/** Why 폴백 */
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

/** details 폴백 */
function buildDetailsFallback(rec) {
  try {
    if (!rec) return null;
    const fv = rec?.debug?.featureVector || {};
    const byCate = rec?.debug?.poi?.byCate || {};
    const top0 = rec?.topCategories?.[0];
    const topCategory = top0?.category || null;

    const {
      rate_20s,
      rate_30s,
      female_rate,
      cmrcl_level,
      pay_cnt_log,
      poi_entropy,
      poi_total,
    } = fv;

    const _rate_20s = rate_20s ?? 0;
    const _rate_30s = rate_30s ?? 0;
    const _female_rate = female_rate ?? 0;
    const _cmrcl_level = cmrcl_level ?? 0;
    const _pay_cnt_log = pay_cnt_log ?? 0;
    const _poi_entropy = poi_entropy ?? 0;
    const _poi_total = poi_total ?? 0;

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

    const hasPayFields =
      Object.prototype.hasOwnProperty.call(fv, "pay_cnt_log") &&
      Object.prototype.hasOwnProperty.call(fv, "cmrcl_level");

    return {
      demographics: {
        female: {
          value: _female_rate,
          label: `여성 ${pctLocal(_female_rate)}`,
        },
        age20s: {
          value: _rate_20s,
          label: `20대 ${pctLocal(_rate_20s)}`,
        },
        age30s: {
          value: _rate_30s,
          label: `30대 ${pctLocal(_rate_30s)}`,
        },
        flags: {
          femaleHigh: _female_rate >= TH.FEMALE_RATE_HIGH,
          age20sHigh: _rate_20s >= TH.RATE20S_HIGH,
          age30sHigh: _rate_30s >= TH.RATE30S_HIGH,
        },
      },
      commerce: {
        cmrcl_level: _cmrcl_level,
        pay_cnt_log: _pay_cnt_log,
        notes:
          hasPayFields &&
          _pay_cnt_log === 0 &&
          _cmrcl_level === 0
            ? "상권(결제) 데이터 없음/부족"
            : undefined,
        flags: {
          payHigh: _pay_cnt_log >= TH.PAY_LOG_HIGH,
          payMid: _pay_cnt_log >= TH.PAY_LOG_MID,
          lvlHigh: _cmrcl_level >= TH.CMR_LEVEL_HIGH,
          lvlMid: _cmrcl_level >= TH.CMR_LEVEL_MID,
        },
      },
      poi: {
        total: _poi_total,
        entropy: _poi_entropy,
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
        flags: { highDiversity: _poi_entropy >= TH.ENTROPY_HIGH },
      },
    };
  } catch {
    return null;
  }
}

function pickGuFromFull(full) {
  if (!full) return null;
  const parts = full.split(" ").filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

/** 표시용 유틸 */
function fmtNum(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n.toFixed(2) : "-";
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
    maxHeight: "60%",
  },
  rowCenter: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
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
  chipLiked: {
    backgroundColor: "#E0F2FE",
    borderColor: "#38BDF8",
  },
  chipBlocked: {
    backgroundColor: "#F3F4F6",
    borderColor: "#D1D5DB",
    opacity: 0.6,
  },
  chipTextBlocked: {
    color: "#9CA3AF",
    textDecorationLine: "line-through",
  },
  brandRank: { fontWeight: "600" },
  brandName: { fontWeight: "600" },
  brandMeta: { fontSize: 11, color: "#4B5563" },
  searchInput: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
  },
  breadcrumb: {
    marginTop: 4,
    fontSize: 11,
    color: "#6B7280",
  },
  advancedToggle: {
    marginTop: 8,
    paddingVertical: 6,
  },
  advancedToggleText: {
    fontSize: 12,
    color: "#2563EB",
    fontWeight: "600",
  },
  advancedBox: {
    marginTop: 4,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
});

export default MapScreen;
